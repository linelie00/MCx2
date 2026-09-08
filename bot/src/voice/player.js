/**
 * player — 길드별 재생 큐와 음성 연결 수명주기
 *
 * 서버가 하나뿐이라 상태는 Map 하나면 충분하다.
 *
 * 이 파일에서 제일 중요한 건 **프로세스 정리**다. skip/stop/오류/퇴장 어느 경로로 끝나도
 * yt-dlp 와 ffmpeg 를 반드시 죽여야 한다. 안 그러면 좀비가 쌓여 Railway 메모리를 먹는다.
 * 그래서 끝내는 길을 stopCurrent() 하나로 모아 두었다.
 */
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} from '@discordjs/voice';
import { openStream } from './ytsource.js';
import config from '../config.js';

/** guildId → 상태 */
const guilds = new Map();

export const LOOP = { OFF: 'off', ONE: 'one', ALL: 'all' };

function stateOf(guildId) {
  let s = guilds.get(guildId);
  if (!s) {
    s = {
      connection: null,
      player: null,
      queue: [],          // { videoId, title, duration, requestedBy }
      current: null,
      loop: LOOP.OFF,
      handle: null,       // 지금 돌고 있는 yt-dlp/ffmpeg
      idleTimer: null,
      onEvent: null,      // 재생 중 알림을 채널로 보내는 콜백
    };
    guilds.set(guildId, s);
  }
  return s;
}

export const getState = (guildId) => guilds.get(guildId) || null;

/** 지금 곡의 프로세스를 정리한다. 끝내는 모든 길이 여기를 지난다. */
function stopCurrent(s) {
  if (s.handle) {
    s.handle.destroy();
    s.handle = null;
  }
  s.current = null;
}

function clearIdle(s) {
  if (s.idleTimer) { clearTimeout(s.idleTimer); s.idleTimer = null; }
}

/** 아무도 없거나 재생이 멈춘 채로 오래 있으면 스스로 나간다. */
function armIdle(s, guildId) {
  clearIdle(s);
  s.idleTimer = setTimeout(() => {
    if (!s.current) leave(guildId);
  }, config.voice.idleSec * 1000);
}

export function leave(guildId) {
  const s = guilds.get(guildId);
  if (!s) return;
  clearIdle(s);
  stopCurrent(s);
  s.queue = [];
  try { s.player?.stop(true); } catch { /* 이미 멈춤 */ }
  try { getVoiceConnection(guildId)?.destroy(); } catch { /* 이미 끊김 */ }
  guilds.delete(guildId);
}

/** 큐에서 다음 곡을 꺼내 재생한다. 큐가 비면 대기 상태로 둔다. */
async function playNext(guildId) {
  const s = stateOf(guildId);
  stopCurrent(s);

  const next = s.queue.shift();
  if (!next) {
    armIdle(s, guildId);
    s.onEvent?.({ type: 'empty' });
    return;
  }

  try {
    // openStream 은 첫 오디오 바이트가 나올 때까지 기다렸다가 돌려준다.
    // 그래야 추출 실패가 "빈 스트림 → 즉시 다음 곡" 으로 조용히 넘어가지 않는다.
    const handle = await openStream(next.videoId);
    s.handle = handle;
    s.current = next;
    clearIdle(s);

    // yt-dlp 출력을 ffmpeg 가 항상 Ogg/Opus 로 정규화하므로 입력 타입이 하나로 고정된다.
    s.player.play(createAudioResource(handle.stream, { inputType: StreamType.OggOpus }));

    // 실제로 소리가 나가는지 확인한다. 추출이 막히면 여기서 걸린다.
    await entersState(s.player, AudioPlayerStatus.Playing, 20_000);
    s.fails = 0;   // 한 곡이라도 되면 연속 실패는 초기화
    s.onEvent?.({ type: 'playing', track: next });
  } catch (err) {
    const detail = (s.handle?.stderr || '').split('\n').filter(Boolean).slice(-2).join(' / ');
    stopCurrent(s);
    const reason = detail || err.message;

    // 한 곡이 실패해도 큐를 죽이지 않는다. 건너뛰고 계속 간다.
    //
    // 다만 ffmpeg 가 없거나 유튜브가 막힌 경우엔 모든 곡이 같은 이유로 실패한다.
    // 그때 곡마다 오류를 뱉으면 채널이 도배되므로, 연속 실패가 쌓이면 멈춘다.
    s.fails = (s.fails || 0) + 1;
    if (s.fails >= 3) {
      const left = s.queue.length;
      s.queue = [];
      s.fails = 0;
      s.onEvent?.({ type: 'aborted', track: next, reason, dropped: left });
      armIdle(s, guildId);
      return;
    }

    s.onEvent?.({ type: 'failed', track: next, reason });
    await playNext(guildId);
  }
}

/** 음성 채널에 들어가고 플레이어를 붙인다. 이미 있으면 그대로 쓴다. */
export async function connect(channel, onEvent) {
  const s = stateOf(channel.guild.id);
  s.onEvent = onEvent;

  if (s.connection && getVoiceConnection(channel.guild.id)) return s;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    // 한 곡 반복이면 방금 곡을 큐 앞에, 전체 반복이면 뒤에 되돌린다.
    if (s.current) {
      if (s.loop === LOOP.ONE) s.queue.unshift(s.current);
      else if (s.loop === LOOP.ALL) s.queue.push(s.current);
    }
    playNext(channel.guild.id).catch((err) => console.error('[voice] 다음 곡 실패:', err));
  });

  player.on('error', (err) => {
    console.error('[voice] 플레이어 오류:', err.message);
    playNext(channel.guild.id).catch(() => {});
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => leave(channel.guild.id));

  s.connection = connection;
  s.player = player;
  return s;
}

/** 큐에 넣는다. 아무것도 안 틀고 있으면 바로 시작한다. */
export async function enqueue(guildId, tracks) {
  const s = stateOf(guildId);
  s.queue.push(...tracks);
  if (!s.current) await playNext(guildId);
}

export async function skip(guildId) {
  const s = guilds.get(guildId);
  if (!s?.current) return false;
  const skipped = s.current;
  // 한 곡 반복 중이면 건너뛰기가 같은 곡을 다시 트는 꼴이 되므로 반복을 무시한다.
  const loop = s.loop;
  s.loop = LOOP.OFF;
  s.player.stop(true);   // Idle 이벤트가 다음 곡을 부른다
  s.loop = loop === LOOP.ONE ? LOOP.OFF : loop;
  return skipped;
}

export function shuffle(guildId) {
  const s = guilds.get(guildId);
  if (!s || s.queue.length < 2) return 0;
  for (let i = s.queue.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
  }
  return s.queue.length;
}

export function setLoop(guildId, mode) {
  const s = stateOf(guildId);
  s.loop = mode;
  return mode;
}

export default { connect, enqueue, skip, shuffle, setLoop, leave, getState, LOOP };
