# DEPLOY — 프론트(Netlify) + 백엔드(Railway)

미하티 프로덕션 배포 가이드.
프론트는 **Netlify**(`mihearti.netlify.app`), 백엔드는 **Railway**(영구 볼륨 + 자동 HTTPS)에 올린다.

```
 브라우저
   │  https://mihearti.netlify.app        (정적 React, Netlify)
   │
   └─ fetch ─▶ https://<service>.up.railway.app   (Railway, 자동 HTTPS)
                     │                              ▲
                     ▼                              │ HTTP (같은 API)
               Node/Express (PORT 자동주입)          │
               └─ DATA_DIR(/data, 영구 볼륨)         │
                    ├─ uploads/        업로드 미디어  │
                    └─ *.json          메타/방명록/플레이리스트
                                                    │
 디스코드 ◀────────────────────────────────  디스코드 봇 (Railway, 같은 레포 bot/)
                                              볼륨·도메인·PORT 없음
```

> Railway는 HTTPS 도메인을 자동 제공하므로 도메인 구매·Caddy·pm2·방화벽이 불필요하다.
> 영구 **볼륨**만 붙이고 `DATA_DIR`을 그 경로로 지정하면 재배포·재시작에도 데이터가 유지된다.

---

## 0. 사전 점검 (이미 코드에 반영됨)

- 프론트 API 주소: `REACT_APP_API_BASE` 환경변수 기반(`client/src/services/*`).
- `client/public/_redirects`: SPA 새로고침 404 방지.
- `CORS_ORIGIN`(허용 도메인 제한), `TRUST_PROXY=1`(프록시 뒤 실제 IP), `PORT`(자동).
- `DATA_DIR` 설정 시 라이브 JSON + `uploads/`를 그 경로(볼륨)에 저장(`server/src/config/paths.js`).
  시드(`*.seed.json`)는 항상 레포에서 읽어 최초 1회 복사.

---

## 1. Railway 프로젝트 생성 (GitHub 연동)

1. railway.app 로그인 → **New Project → Deploy from GitHub repo** → 이 레포 선택.
2. 생성된 서비스 → **Settings**:
   - **Root Directory**: `server` (모노레포라 서버 폴더만 빌드)
   - Build/Start는 자동(Nixpacks): `npm install` → `npm start`(=`node server.js`).
     Node는 `server/package.json`의 `engines`(>=18)를 따른다.

---

## 2. 환경변수 설정

서비스 → **Variables** 에 추가:
```
OWNER_MATIAM_KEY = 실제_마티암_패스코드
OWNER_MIGEL_KEY  = 실제_미겔_패스코드
BOT_KEY          = 디스코드_봇_전용_키   ← 오너 패스코드와 다른 값
YOUTUBE_API_KEY  = 실제_유튜브_API_키
CORS_ORIGIN      = https://mihearti.netlify.app
TRUST_PROXY      = 1
DATA_DIR         = /data
```
> `PORT`는 Railway가 자동 주입하므로 설정하지 않는다.

---

## 3. 영구 볼륨 추가

서비스 → **Settings → Volumes → New Volume**:
- **Mount path**: `/data` (위 `DATA_DIR`과 동일해야 함)

이제 업로드 미디어와 `*.json` 라이브 데이터가 `/data`에 쌓여 **재배포에도 유지**된다.
(볼륨이 비어 있으면 시드가 자동 복사되어 빈 갤러리/빈 플레이리스트로 시작.)

---

## 4. 공개 도메인(HTTPS) 생성

서비스 → **Settings → Networking → Generate Domain** →
`https://<service>.up.railway.app` 발급(자동 HTTPS). 이 주소를 메모 → `<API_URL>`.

확인:
```bash
curl <API_URL>/             # MIHEARTI API
curl <API_URL>/api/playlist # [] 또는 데이터
```

---

## 5. Netlify 연결

1. Netlify 사이트 → **Site configuration → Environment variables**:
   - `REACT_APP_API_BASE = <API_URL>`
2. **Deploys → Trigger deploy → Clear cache and deploy site**
   (CRA는 빌드 시점에 env를 박으므로 재배포 필수. `_redirects`도 이때 반영됨.)

---

## 6. 기존 이미지·데이터 이전 ⚠️ (관리형 호스팅의 약점)

`uploads/`와 라이브 `*.json`은 git에 없고, **Railway 볼륨엔 외부에서 직접 파일을 밀어넣기가 까다롭다**
(VM의 scp 같은 게 없음). 현실적인 방법:

- **갤러리(이미지 수백 장)**: 배포 후 사이트에서 **관리자 로그인 → 업로드**로 채운다.
  업로드는 **다중 선택 + 앨범 묶기**를 지원하므로 배치로 올릴 수 있다.
- **방명록 / 플레이리스트**: 데이터가 작으니 앱에서 다시 만들면 된다(플레이리스트는 검색/링크로 재구성).

> 수백 장 재업로드가 부담이면, 파일 푸시가 쉬운 VM(scp/sftp) 또는 SFTP를 지원하는 호스트가 더 편하다.
> 이 프로젝트의 갤러리 규모상 이 부분만 한 번 감수하면 이후 운영은 매우 단순하다.

---

## 7. 검증

브라우저(`https://mihearti.netlify.app`)에서:
- 갤러리 업로드/모달/다운로드
- 플레이리스트 재생 → 다른 페이지 이동 시 미니 플레이어 유지
- 방명록 작성(쿨다운/캡차) — 여러 기기에서 IP 쿨다운이 개별 적용되는지(`TRUST_PROXY=1`)
- **관리자 로그인** 후 쓰기(업로드/태그/곡 추가)

---

## 8. 업데이트 / 백업

- **업데이트**: GitHub에 push → Railway가 **자동 재배포**. 볼륨 데이터는 유지됨.
- **백업**: 볼륨 데이터(특히 `uploads/`)는 주기적으로 백업 권장.
  앱에서 받거나, Railway CLI로 서비스에 접속해 `/data`를 아카이브해 내려받는 식.
  (관리형 볼륨은 VM만큼 백업이 간편하진 않으니, 중요 이미지는 원본을 로컬에도 보관.)
- **`accounts.json` 은 유일본이다.** 갤러리·플리·영화는 시드가 받쳐 주지만 카지노
  계정(골드·칭호·아이템)은 시드가 비어 있어 잃으면 복구되지 않는다. 백업 대상에 꼭 넣는다.

---

## 9. 디스코드 봇 서비스 (선택)

같은 레포의 `bot/` 폴더를 **별도 서비스**로 올린다. 봇은 사이트 데이터를 전부 HTTP API 로만
다루므로 볼륨이 필요 없고, API 서비스와 독립적으로 재시작된다.

1. 같은 프로젝트에서 **New Service → GitHub Repo → 같은 레포**
2. Settings → **Root Directory = `bot`**
3. Settings → **Watch Paths = `/bot/**`**
4. **기존 `server` 서비스에도 Watch Paths = `/server/**` 를 추가한다.**
   안 하면 봇만 고쳐도 API 가 같이 재배포된다.
5. Variables (자세한 목록은 `bot/.env.example`):
```
DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID
DISCORD_USER_MIGEL, DISCORD_USER_MATIAM     디스코드 유저 ID (쓰기 권한 판단)
MIHEARTI_API_BASE                            server 서비스의 공개 도메인
OWNER_MIGEL_KEY, OWNER_MATIAM_KEY            server 와 같은 값
BOT_KEY                                      server 와 같은 값 (골드·계정)
GEMINI_API_KEY                               캐입 핑퐁용
SITE_BASE                                    프론트 주소 (선택, 링크 안내용)
```
6. **볼륨·공개 도메인·PORT 모두 불필요.** 워커 서비스로 둔다.
7. **server 를 먼저 배포하고** `/api/accounts` 가 (키 없이) 401 로 응답하는지 확인한 뒤
   봇을 올린다. 순서가 뒤집히면 봇은 뜨지만 **카지노 판이 전부 거절된다** — 잔액을 못
   읽으면 판을 여는 것 자체가 실패이고, 그게 설계된 실패 모드다(CASINO_GOLD.md §5-4).
   봇 로그 첫 줄의 `[api] 봇 키 확인: ✔` 로도 알 수 있다.
8. 첫 배포 후 로컬에서 `cd bot && npm run register` 를 한 번 실행해 슬래시 명령을 등록한다.
   (명령 이름·옵션을 바꿨을 때만 다시 실행)

> Root Directory 를 `bot` 으로 두면 Railway 는 그 폴더만 내려받는다. 런타임에 `../client` 는
> 존재하지 않으므로 캐릭터·대사 데이터는 생성해서 `bot/data/` 에 커밋해 둔다.
> 원본(`client/src/Data/`)을 고쳤으면 `node bot/scripts/build-content.mjs` 를 다시 돌린다.

자세한 운영·복구 방법은 `bot/README.md` 참고.

---

## 트러블슈팅

- **CORS 에러**: `CORS_ORIGIN`이 프론트 주소와 정확히 일치하는지(https, 끝 슬래시 없음). 변경 후 재배포.
- **Mixed content 차단**: `REACT_APP_API_BASE`가 반드시 `https://`.
- **빌드가 client를 잡음**: 서비스 **Root Directory = `server`** 확인.
- **재배포 후 데이터 사라짐**: 볼륨 mount path와 `DATA_DIR`(`/data`)이 일치하는지 확인.
- **방명록 쿨다운이 전체 공유됨**: `TRUST_PROXY=1` 설정 확인.
- **영상 poster 생성 실패**: 로그에 ffmpeg 오류 시 — 이미지(jpg/png/webp)만 쓰면 영향 없음.
  영상이 필요하면 `ffmpeg-static`/`ffprobe-static`이 빌드 환경에서 동작하는지 로그로 확인.
- **봇이 판을 못 엶 ("골드 잔액을 읽지 못해…")**: 두 서비스의 `BOT_KEY` 가 같은 값인지.
  `cd bot && npm run check-keys` 로 확인할 수 있다(키 값은 출력하지 않고 지문만 보여준다).
- **봇이 사이트에 연결 못 함**: `MIHEARTI_API_BASE` 에 `https://` 가 붙어 있는지.
  Railway 대시보드는 도메인을 스킴 없이 보여준다(봇이 보정하긴 하지만 로그로 확인할 것).
- **봇 쓰기 명령이 401**: `cd bot && npm run check-keys` 로 패스코드가 서버와 같은지 확인.
  사이트는 localStorage 만 보고 로그인 상태를 표시하므로, 값이 바뀌어도 로그인된 것처럼 보인다.
