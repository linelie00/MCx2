# MIHEARTI 디스코드 봇

사이트(`client` + `server`)에 연결되는 디스코드 봇. 둘만 쓰는 비공개 서버용.

데이터는 **전부 사이트 API(HTTP)를 통해서만** 읽고 쓴다.
`server/src/data/*.json` 을 직접 열면 안 된다 — 그 스토어들은 파일 전체를 통째로 덮어쓰는
방식이라 락이 없고, 두 프로세스가 같이 쓰면 갱신이 유실된다.

## 필요한 것

- **Node 22 이상.** `@discordjs/voice` 가 `>=22.12.0` 을 요구한다.
  ```bash
  nvm install 22 && nvm use 22
  ```
- ffmpeg 는 따로 안 깔아도 된다 — `ffmpeg-static` 패키지로 들고 온다.
  시스템에 있으면 그쪽을 먼저 쓴다.

## 로컬 실행

```bash
cd bot
cp .env.example .env      # 값을 채운다
npm install
npm run register          # 슬래시 명령 등록 (명령 이름/옵션을 바꿨을 때만)
npm run dev
```

`.env` 에 넣을 값은 `.env.example` 의 주석을 참고할 것. 토큰과 패스코드가 들어가므로
**절대 커밋하지 않는다**(`.gitignore` 에 있음).

## Railway 배포

기존 프로젝트에 **서비스를 하나 더** 만든다. 서버와 같은 레포를 쓰되 폴더만 다르다.

1. New Service → GitHub Repo → 같은 레포
2. Settings → **Root Directory = `bot`**
3. Settings → **Watch Paths = `/bot/**`**
4. **기존 `server` 서비스에도 Watch Paths = `/server/**` 를 추가한다.**
   안 하면 봇만 고쳐도 API 가 같이 재배포된다.
5. Variables 에 `.env.example` 의 값들 + `NIXPACKS_NODE_VERSION=22`
   - `YOUTUBE_DL_FILENAME=yt-dlp_linux` 와 `YOUTUBE_DL_SKIP_PYTHON_CHECK=1` 은
     **빌드(npm install) 때 필요하다.** 없으면 파이썬이 없다며 설치가 실패한다.
   - `MIHEARTI_API_BASE` 는 `server` 서비스의 공개 도메인
   - `OWNER_*_KEY` 는 `server` 와 같은 값
6. 볼륨·공개 도메인·PORT **모두 불필요**. 워커 서비스로 둔다.

> Root Directory 를 `bot` 으로 두면 Railway 는 그 폴더만 내려받는다.
> 런타임에 `../client` 는 존재하지 않으므로, 캐릭터·대사 데이터는 생성해서
> `bot/data/` 에 커밋해 둔다(`npm run build-content`).

## 명령

| 명령 | 권한 | 설명 |
|---|---|---|
| `/주사위` | 누구나 | 면·개수·보정을 받아 굴린다 |
| `/뽑기` | 누구나 | 쉼표로 구분한 항목에서 무작위 선택 |
| `/음성테스트` | 누구나 | 배포 환경에서 음성 UDP 가 뚫리는지 진단 |
| `/대사` `/그림` `/영화` `/플리` | 조회는 누구나 | 사이트 데이터 조회·수정 |
| `/캐입` | 누구나 | 미겔·마티암과 대화 (Gemini) |
| `/플리 재생` 계열 | 누구나 | 음성 채널에서 재생 |

## 음성이 안 될 때

Railway 에서 디스코드 음성 UDP 가 막히는 사례가 보고돼 있다(미해결).
`/음성테스트` 가 **Ready 단계에서 타임아웃**하면 코드 문제가 아니라 호스트 문제다.
그 경우 봇만 다른 호스트로 옮기면 된다 — 봇은 API 를 HTTP 로만 쓰므로 이전 비용이 거의 없다.

> 유튜브 추출에는 **JS 런타임**이 필요하다. 없으면 챌린지를 못 풀어
> "Sign in to confirm you're not a bot" 으로 막힌다. 가정용 IP 에서는 챌린지가 잘 안 나와
> 문제가 드러나지 않지만 데이터센터 IP 에서는 바로 걸린다.
> Node 앱이라 node 가 항상 있으므로 `--js-runtimes node` 를 기본으로 붙인다(설치할 것 없음).

재생이 되다가 나중에 깨졌다면 순서대로:

1. Railway 에서 **Redeploy** — `youtube-dl-exec` 가 설치 시 최신 yt-dlp 를 받으므로
   코드 변경 없이 대응되는 경우가 많다
2. `YTDLP_EXTRA_ARGS` 조정 (배포 없이 변수만) — 예: `--extractor-args youtube:player_client=android_vr`
3. `YT_COOKIES_B64` 주입 — **반드시 버리는 구글 계정으로**. 데이터센터 IP 에서 쓰면
   세션이 빨리 무효화되고 최악의 경우 계정 제재를 받는다

## 데이터 재생성

캐릭터·대사·세계관은 `client/src/Data/` 가 원본이고, 봇은 생성된 JSON 만 읽는다.
원본을 고쳤으면 **레포 루트에서** 다시 생성하고 커밋한다.

```bash
node bot/scripts/build-content.mjs
```

`bot/data/quotes.json`(명대사)만 예외로 사람이 직접 편집하는 파일이고, 생성 스크립트가 덮지 않는다.
