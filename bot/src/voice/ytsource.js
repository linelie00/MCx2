/**
 * ytsource — 유튜브 영상 하나를 디스코드에 넣을 수 있는 오디오 스트림으로 바꾼다.
 *
 * 이 파일이 이 기능에서 가장 잘 깨지는 곳이다. 유튜브가 패치할 때마다 추출이 막히므로
 * 다른 코드와 섞지 않고 여기 한 곳에 가둬 둔다. 깨지면 여기만 고치면 된다.
 *
 * 복구 순서 (README 에도 적어 둠):
 *   1. Railway 에서 Redeploy — 설치할 때 최신 yt-dlp 를 받으므로 코드 변경 없이 되는 경우가 많다
 *   2. YTDLP_EXTRA_ARGS 조정 — 배포 없이 변수만 (예: --extractor-args youtube:player_client=android_vr)
 *   3. YT_COOKIES_B64 주입 — 반드시 버리는 구글 계정으로
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import config from '../config.js';

const require_ = createRequire(import.meta.url);

/** youtube-dl-exec 가 받아 둔 바이너리 경로. 이 패키지는 실행 파일 위치를 이렇게만 알려준다. */
function ytdlpPath() {
  const dir = path.join(path.dirname(require_.resolve('youtube-dl-exec/package.json')), 'bin');
  const found = fs.readdirSync(dir).find((f) => f.startsWith('yt-dlp'));
  if (!found) throw new Error('yt-dlp 바이너리를 찾지 못했습니다.');
  return path.join(dir, found);
}

/**
 * 쿠키는 환경변수에 base64 로 넣는다. Railway 봇 서비스에는 볼륨이 없어서 파일로 둘 수 없다.
 * 부팅 때 한 번 임시 파일로 풀어 놓고 그 경로를 쓴다.
 */
let cookiesPath = null;
function ensureCookies() {
  if (cookiesPath !== null) return cookiesPath;
  if (!config.voice.cookiesB64) { cookiesPath = ''; return cookiesPath; }
  try {
    const file = path.join(os.tmpdir(), 'mihearti-yt-cookies.txt');
    fs.writeFileSync(file, Buffer.from(config.voice.cookiesB64, 'base64'));
    cookiesPath = file;
    console.log('[voice] 유튜브 쿠키를 사용합니다.');
  } catch (err) {
    console.warn('[voice] 쿠키를 풀지 못했습니다:', err.message);
    cookiesPath = '';
  }
  return cookiesPath;
}

/** 배포 없이 조정할 수 있게 추가 인자를 환경변수로 받는다. 막혔을 때 제일 먼저 쓰는 손잡이다. */
const extraArgs = () =>
  config.voice.ytdlpExtraArgs.split(/\s+/).filter(Boolean);

/**
 * videoId 하나를 Ogg/Opus 스트림으로 연다.
 *
 * yt-dlp 가 주는 최적 오디오는 webm/opus 일 때도 m4a/AAC 일 때도 있다. 항상 ffmpeg 로
 * Ogg/Opus 로 정규화하면 재생 경로가 하나로 유지되고 demuxProbe 분기가 사라진다.
 * ffmpeg 는 nixpacks.toml 로 이미 깔려 있다.
 *
 * 반환한 handle 은 반드시 destroy() 로 정리해야 한다. 안 그러면 좀비 프로세스가 쌓인다.
 */
export function openStream(videoId) {
  const cookies = ensureCookies();

  const dl = spawn(ytdlpPath(), [
    `https://www.youtube.com/watch?v=${videoId}`,
    '--output', '-',                 // stdout 으로 흘린다
    '--format', 'bestaudio/best',
    '--no-playlist',
    '--quiet', '--no-warnings',
    '--retries', '3',
    '--socket-timeout', '15',
    ...(cookies ? ['--cookies', cookies] : []),
    ...extraArgs(),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const ff = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-vn',
    '-ar', '48000', '-ac', '2',      // 디스코드가 요구하는 48kHz 스테레오
    '-c:a', 'libopus', '-b:a', '96k',
    '-f', 'ogg', 'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });

  // yt-dlp 가 실패하면 그 이유가 stderr 에만 나온다. 사용자에게 보여주려고 모아 둔다.
  let stderr = '';
  dl.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2000); });

  dl.stdout.pipe(ff.stdin);

  // 곡을 넘기거나 멈추면 프로세스를 죽이는데, 그때 파이프 한쪽이 먼저 닫히며 EPIPE 가 난다.
  // 정상적인 종료 과정이라 무시해야 한다. 스트림 에러는 아무도 안 듣고 있으면 프로세스를
  // 통째로 죽이므로(uncaught), 파이프에 관여하는 스트림 전부에 핸들러를 달아 둔다.
  const hush = () => {};
  dl.stdout.on('error', hush);
  dl.stderr.on('error', hush);
  ff.stdin.on('error', hush);
  ff.stdout.on('error', hush);
  dl.on('error', hush);
  ff.on('error', hush);

  let destroyed = false;
  return {
    stream: ff.stdout,
    get stderr() { return stderr; },
    /** 어떤 경로로 끝나든 반드시 부른다 — skip/stop/error/퇴장 전부. */
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { dl.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
      try { ff.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
    },
  };
}

/** 유튜브 링크나 검색어에서 videoId 를 얻는다. 링크면 그대로, 아니면 검색한다. */
export async function resolve(input) {
  const direct = String(input).match(
    /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/v\/)([A-Za-z0-9_-]{11})/,
  );
  if (direct) return { videoId: direct[1] };
  if (/^[A-Za-z0-9_-]{11}$/.test(input.trim())) return { videoId: input.trim() };

  // 검색은 yt-dlp 로 한다. 사이트의 /api/playlist/search 는 호출당 유튜브 쿼터를 100 쓰므로
  // 여기서는 쓰지 않고, 쿼터는 곡 추가(1)에만 남긴다.
  const cookies = ensureCookies();
  const args = [
    `ytsearch1:${input}`,
    '--dump-single-json', '--flat-playlist', '--no-warnings', '--quiet',
    ...(cookies ? ['--cookies', cookies] : []),
    ...extraArgs(),
  ];

  const out = await new Promise((res, rej) => {
    const p = spawn(ytdlpPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr.on('data', (c) => { stderr += c; });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res(stdout) : rej(new Error(stderr.slice(-300) || `yt-dlp 종료 코드 ${code}`))));
  });

  const first = JSON.parse(out).entries?.[0];
  if (!first) throw new Error('검색 결과가 없어요.');
  return { videoId: first.id, title: first.title, duration: first.duration };
}

export default { openStream, resolve };
