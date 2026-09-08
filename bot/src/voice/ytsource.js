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
import { spawn, execFile } from 'node:child_process';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import config from '../config.js';

const require_ = createRequire(import.meta.url);

/**
 * ffmpeg 경로.
 *
 * 처음엔 nixpacks.toml 의 aptPkgs 로 시스템 ffmpeg 를 깔아 쓰려 했는데, Railway 에서
 * 그게 적용되지 않아 재생이 전부 ENOENT 로 실패했다(빌더 설정에 좌우된다).
 * 패키지로 들고 오면 빌더가 무엇이든 상관없다 — server 와 이미지 최적화 스크립트도
 * 같은 방식을 쓴다. 그래도 시스템에 있으면 그쪽을 먼저 쓴다.
 */
function ffmpegPath() {
  try {
    const bin = require_('ffmpeg-static');
    if (bin && fs.existsSync(bin)) return bin;
  } catch { /* 아래 PATH 로 */ }
  return 'ffmpeg';
}

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
 *
 * 반환한 handle 은 반드시 destroy() 로 정리해야 한다. 안 그러면 좀비 프로세스가 쌓인다.
 */
export async function openStream(videoId) {
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

  const ff = spawn(ffmpegPath(), [
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
  // 그건 무시해야 하지만, spawn 자체의 실패(ENOENT 등)까지 삼키면 안 된다 —
  // 실제로 그렇게 해서 "소리는 안 나는데 곡만 순식간에 넘어가는" 증상을 만들었다.
  // 파이프 에러는 무시하고, 프로세스 에러는 기록해 둔다.
  const hush = () => {};
  dl.stdout.on('error', hush);
  dl.stderr.on('error', hush);
  ff.stdin.on('error', hush);
  ff.stdout.on('error', hush);

  let spawnError = null;
  dl.on('error', (e) => { spawnError = `yt-dlp 실행 실패: ${e.code || e.message}`; });
  ff.on('error', (e) => { spawnError = `ffmpeg 실행 실패: ${e.code || e.message}`; });

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    try { dl.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
    try { ff.kill('SIGKILL'); } catch { /* 이미 죽음 */ }
  };

  // 첫 오디오 바이트가 실제로 나오는지 여기서 확인한다.
  //
  // 그냥 ff.stdout 을 넘기면, 추출이 실패해 빈 스트림이 와도 플레이어는 "재생 시작 → 즉시 끝"
  // 으로 보고 다음 곡으로 넘어간다. 7곡이 순식간에 지나가고 소리는 안 나는 게 그 증상이었다.
  // 첫 바이트를 기다렸다가 넘기면 실패가 실패로 드러난다.
  //
  // 버퍼에 쌓인 채로 기다릴 수 있게 PassThrough 를 끼운다.
  const out = new PassThrough();
  ff.stdout.pipe(out);

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      fail(new Error('20초 안에 오디오가 나오지 않았어요.'));
    }, 20_000);

    const cleanup = () => {
      clearTimeout(timer);
      out.off('readable', onReadable);
      out.off('end', onEnd);
      out.off('close', onEnd);
    };
    const fail = (err) => {
      cleanup();
      destroy();
      const why = spawnError || stderr.split('\n').filter(Boolean).slice(-2).join(' / ');
      reject(new Error(why || err.message));
    };

    // 'data' 로 기다리면 안 된다 — 스트림이 흐름 모드가 되면서 첫 청크가 소비돼 버려진다.
    // Ogg 는 첫 페이지가 헤더라, 그게 사라지면 디코더가 아무것도 못 읽고 즉시 끝난다.
    // (실제로 "▶ 는 뜨는데 소리가 안 나는" 증상이 이것 때문이었다.)
    // 'readable' 은 읽지 않는 한 아무것도 소비하지 않으므로, 버퍼에 쌓인 양만 확인한다.
    function onReadable() {
      if (out.readableLength > 0) { cleanup(); resolve(); }
    }
    function onEnd() { fail(new Error('오디오가 나오지 않았어요.')); }

    out.on('readable', onReadable);
    out.once('end', onEnd);
    out.once('close', onEnd);
    onReadable();   // 이미 쌓여 있을 수도 있다
  });

  return {
    stream: out,
    get stderr() { return stderr; },
    /** 어떤 경로로 끝나든 반드시 부른다 — skip/stop/error/퇴장 전부. */
    destroy,
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

/**
 * 부팅 시 yt-dlp 와 ffmpeg 가 실제로 실행되는지 확인한다.
 *
 * 둘 중 하나라도 없으면 재생은 "소리 없이 곡만 넘어가는" 형태로 조용히 실패한다.
 * 배포 로그 첫 줄에서 드러나게 해 두는 편이 훨씬 낫다.
 */
export async function checkBinaries() {
  const run = (cmd, args) => new Promise((res) => {
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout) => {
      if (err) res({ ok: false, why: err.code || err.message });
      else res({ ok: true, out: String(stdout).trim().split(/\r?\n/)[0] });
    });
  });

  let yt;
  try {
    yt = await run(ytdlpPath(), ['--version']);
  } catch (err) {
    yt = { ok: false, why: err.message };
  }
  console.log(yt.ok ? `[voice] yt-dlp ${yt.out}` : `[voice] yt-dlp 사용 불가 — ${yt.why}`);

  const ffBin = ffmpegPath();
  const ff = await run(ffBin, ['-version']);
  const where = ffBin === 'ffmpeg' ? 'PATH' : 'ffmpeg-static';
  console.log(ff.ok
    ? `[voice] ${ff.out.slice(0, 50)} (${where})`
    : `[voice] ffmpeg 사용 불가 — ${ff.why} (${where})`);

  // 유튜브가 막을 때 쓰는 손잡이 두 개가 실제로 전달됐는지 보여준다.
  // 변수를 넣었는데 안 먹는 건지, 넣어도 소용없는 건지 구분하려면 이게 필요하다.
  const extra = extraArgs();
  console.log(`[voice] YTDLP_EXTRA_ARGS: ${extra.length ? extra.join(' ') : '(없음)'}`);
  console.log(`[voice] 쿠키: ${ensureCookies() ? '사용' : '없음'}`);

  return yt.ok && ff.ok;
}

export default { openStream, resolve, checkBinaries };
