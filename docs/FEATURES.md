# FEATURES

미하티(MIHEARTI)에 추가된 주요 기능과 백엔드 도입의 큰 흐름을 정리한 문서입니다.
(최종 갱신: 2026-06-08)

> 정적 페이지(Home/World/Character)에 이어, **갤러리·스토리 뷰어·방명록·플레이리스트**와
> 이를 뒷받침하는 **Express API + 로컬 파일 저장소**가 추가되었습니다.

---

## 1. 백엔드 (server/)

최소한의 Express API 서버. 이미지/영상 저장·서빙, 방명록, 오너 인증을 담당합니다.

### 폴더 구조

```
server/
├── server.js                  진입점 (dotenv 로드 + listen, 포트 8000 / PORT)
├── .env                       오너 키 (gitignore)  · .env.example 은 커밋
├── scripts/
│   └── import-folder.js       로컬 폴더 일괄 임포트 (일회성 도구)
├── uploads/                   업로드된 미디어 파일 (gitignore)
└── src/
    ├── app.js                 cors + /uploads 정적 + /api/* 라우트 등록
    ├── config/
    │   └── paths.js           데이터/업로드 경로 (DATA_DIR=볼륨 대응, 미설정 시 로컬)
    ├── middleware/
    │   └── requireOwner.js    X-Owner-Key 검증 (쓰기 보호)
    ├── routes/                gallery.js · auth.js · guestbook.js · playlist.js
    ├── controllers/           galleryController.js · guestbookController.js · playlistController.js
    ├── services/
    │   ├── storageService.js  로컬 저장 + 치수 측정 + 영상 poster(ffmpeg)
    │   ├── metaStore.js       gallery.json 읽기/쓰기 (없으면 seed 복사)
    │   ├── guestbookStore.js  guestbook.json 읽기/쓰기
    │   ├── playlistStore.js   playlists.json 읽기/쓰기 (없으면 seed 복사)
    │   └── youtubeService.js  YouTube Data API v3 (videoId 추출 · 메타 조회 · 검색)
    └── data/
        ├── gallery.seed.json     기본 태그 시드 (커밋)
        ├── gallery.json          라이브 갤러리 데이터 (gitignore)
        ├── guestbook.json        라이브 방명록 데이터 (gitignore)
        ├── playlists.seed.json   빈 구조 시드 (커밋)
        └── playlists.json        라이브 플레이리스트 데이터 (gitignore)
```

### 의존성

`express`, `cors`, `dotenv`, `multer`(업로드), `image-size`(이미지 치수),
`fluent-ffmpeg`+`ffmpeg-static`+`ffprobe-static`(영상 치수·poster).
플레이리스트는 **새 의존성 없이** Node 전역 `fetch`로 YouTube Data API v3를 호출한다
(재생은 클라이언트의 IFrame Player API, 키 불필요).

### API 요약

```
# 인증
GET    /api/auth/me                 오너 키 검증 → { owner }

# 갤러리 (읽기/다운로드 공개, 쓰기는 오너)
GET    /api/gallery/images?tag=
GET    /api/gallery/download/:name  Content-Disposition attachment 스트리밍
GET    /api/gallery/tags
POST   /api/gallery/images          (owner) multipart files[] + tags + group
DELETE /api/gallery/images/:id      (owner)
PATCH  /api/gallery/images/:id      (owner) 태그 수정
POST   /api/gallery/tags            (owner)
PATCH  /api/gallery/tags/order      (owner) 순서 변경  ※ ':id'보다 먼저 등록
PATCH  /api/gallery/tags/:id        (owner) 이름 변경
DELETE /api/gallery/tags/:id        (owner)

# 방명록 (조회/작성 공개, 삭제는 오너)
GET    /api/guestbook
GET    /api/guestbook/challenge     산수 캡차 발급
POST   /api/guestbook               허니팟·쿨다운·캡차 검증 후 저장
DELETE /api/guestbook/:id           (owner)

# 플레이리스트 (조회 공개, 쓰기/검색은 오너)
GET    /api/playlist                          전체 재생목록(+캐싱 트랙)
GET    /api/playlist/search?q=                (owner) 곡 이름 검색  ※ ':id'보다 먼저
POST   /api/playlist                          (owner) 재생목록 생성
PATCH  /api/playlist/order                     (owner) 재생목록 순서  ※ ':id'보다 먼저
PATCH  /api/playlist/:id                        (owner) 제목/설명/accent
DELETE /api/playlist/:id                        (owner)
POST   /api/playlist/:id/tracks                 (owner) {url,note} → 메타 조회·저장
PATCH  /api/playlist/:id/tracks/order           (owner) 트랙 순서  ※ ':trackId'보다 먼저
PATCH  /api/playlist/:id/tracks/:trackId        (owner) note 수정
DELETE /api/playlist/:id/tracks/:trackId        (owner)
```

---

## 2. 오너 쓰기 권한 (패스코드)

오너 2명(마티암오너/미겔오너)에게만 쓰기 권한. 계정 시스템 없이 경량 패스코드.

- 서버: `.env`의 `OWNER_MATIAM_KEY` / `OWNER_MIGEL_KEY`. `requireOwner` 미들웨어가
  요청 헤더 `X-Owner-Key`를 검증하고 `req.owner`(`matiam`/`migel`)를 채움. 미일치 401.
- 클라이언트: `services/ownerAuth.js`(localStorage) + `contexts/OwnerContext.jsx`(`useOwner`).
  갤러리 헤더의 **"관리자 로그인"** 텍스트 버튼으로 패스코드 입력 → 검증 후 편집 모드.
  쓰기 요청에 `X-Owner-Key`를 자동 첨부.
- 비오너에겐 업로드·태그관리·태그수정·삭제 UI가 숨겨짐(감상·다운로드만).
- 보안 메모: 공유 비밀이라 공개 배포 시 **HTTPS 필수**. 로컬에선 무관.

---

## 3. 갤러리 (/image)

핀터레스트풍 메이슨리 갤러리. `Pages/Gallery.js` + `Components/gallery/*`.

### 데이터 모델

```txt
Media { id, type:'image'|'video', url, poster?, width, height, tags[], createdAt }
Album { ...Media, items:[Media...] }   // items 가 있으면 앨범(대표=첫 항목)
Tag   { id(slug), label }
```
- `width/height` 저장 → 메이슨리가 로드 전 자리 확보(레이아웃 밀림 방지).
- 영상은 그리드에서 poster + ▶ 배지, 모달에서 재생. gif는 image로 취급.

### 메이슨리 (GalleryGrid)

- 저장된 width/height로 **가장 짧은 컬럼에 배치**하는 자체 균형 분배.
- **컬럼은 `flex:1 1 0`로 동일 너비** 고정(불균등 시 한 컬럼이 좁아져 비어 보이던 근본 원인 해결).
- 균형 계산에 **카드 간격(16px)을 비율로 환산해 더함**(카드 많은 컬럼 누적 오차 보정).
- 카드 최대 세로비 `MAX_CARD_RATIO=2`(galleryLayout.js) — 초장신 이미지는 썸네일만 크롭,
  원본 비율은 모달에서.

### 무한 스크롤 · 로딩 우선순위

- 하단 sentinel + IntersectionObserver, 미리로드 거리 **화면 높이 2배**(로딩 경계 숨김).
- 카드별 IntersectionObserver(rootMargin 300px)로 **뷰포트 근처일 때만 이미지 로드**
  → 보이는 모든 컬럼이 (보이는 것 우선) 균등하게 채워짐. 로드 전 양피지색 자리표시 + 페이드인.

### 정렬 · 태그 필터

- 방문마다 seed 기반 셔플(무한스크롤 중 순서 고정).
- 태그 **다중 선택(AND)** + 검색. 기본은 '전체'.

### 태그 관리(오너)

- '태그 관리' 모드에서 추가 / 이름 변경(칩 클릭) / 삭제(×) / **순서 변경**.
- 순서 변경은 네이티브 DnD 대신 **포인터(마우스/터치) 기반 드래그 + FLIP 슬라이드 애니메이션**.
  `⠿` 손잡이를 잡고 삽입 지점(칩 좌/우 절반)으로 이동, 원위치 복귀 가능. 서버 `tags/order`에 저장.

### 업로드 · 다운로드 (오너 / 공개)

- 업로드: **다중 파일** + "한 앨범으로 묶기" 토글(앨범 1카드 / 개별 카드).
  서버가 치수·타입·영상 poster 처리.
- 다운로드: 모달 우상단 아이콘 → `download/:name`(attachment). 앨범은 현재 보는 항목.

### 앨범 (모달 캐러셀)

- 임포트 시 **하위 폴더 = 앨범**(items[]). 카드엔 장수 배지(▣ N).
- 모달에서 ‹ › / 키보드 ←→ / 카운터로 넘김.

---

## 4. 폴더 일괄 임포트

`server/scripts/import-folder.js` — 일회성 도구.

```bash
cd server
npm run import -- "C:\\경로\\갤러리폴더"
```
- **최상위 폴더 = 태그**, 그 안의 **하위 폴더 = 앨범**(평탄화), 직속 파일 = 개별.
- 이미지/영상만 처리(그 외 확장자 스킵), uploads로 복사 + 치수/poster.
- 같은 label의 기존 태그가 있으면 id 재사용(중복 라벨 방지). **append-only(1회만 실행)**.

---

## 5. 스토리 뷰어 (/story)

11개 세션을 **한 권의 책**으로 합쳐 넘겨 보는 뷰어. `Pages/Story.js` + `Styles/StoryBook.css`.

- 높이 측정 기반 자동 페이지네이션(시점별 라벨, 도비라/속표지, 삽화 배치).
- **데스크톱: 흰 종이 양면 + 3D 넘김 / 모바일: 단일 페이지 + 좌우 탭 이동**.
- 상단 타임라인으로 세션 점프.

---

## 6. 방명록 (Home 하단)

`Components/guestbook/Guestbook.jsx` + `Styles/Guestbook.css`.

- 닉네임 + 코멘트 작성(공개) + 지난 방명록 목록. 오너에게만 삭제(×) 노출.
- **스팸 방지(의존성 없음)**:
  - 연속 등록 제한(IP 쿨다운 30초, 429)
  - 허니팟(보이지 않는 필드가 채워지면 조용히 폐기)
  - 산수 캡차(`/challenge` 발급 → 1회용·5분 만료, POST 시 정답 검증)

---

## 7. 플레이리스트 (/playlist)

오너가 자유롭게 만든 **테마별 재생목록**을 감상하는 음악 기록 보관소.
`Pages/Playlist.js` + `Components/playlist/*` + `Styles/Playlist.css`.

### 데이터 모델 (`playlists.json`)

```txt
Playlist { id, title, description?, accent('migel'|'matiam'|null), order, createdAt,
           tracks:[ Track ] }
Track    { id, videoId, title, channel, thumbnail, duration(초), note?, addedAt }
```
- 고정 테마 없음 — 시드는 빈 구조. 재생목록은 전부 오너가 UI에서 생성.
- `accent`를 고르면 섹션 강조선이 캐릭터 색(`Data/constants/colors.js`)으로 표시된다.

### 두 개의 YouTube API

- **Data API v3 (서버, 키 필요)** — 곡 추가/검색 시에만 호출해 메타를 **캐싱**.
  추가는 `videos.list`(1 unit/곡), 이름 검색은 `search.list`(100 units/검색).
  페이지 로드는 캐싱 값만 쓰므로 **Data API 호출 0**.
- **IFrame Player API (클라이언트, 키 불필요)** — 페이지 내 임베드 재생.

### 곡 추가 (오너)

- **이름으로 검색**: `search.list` 결과(썸네일·제목·채널)에서 골라 추가.
  다이얼로그가 유지돼 여러 곡 연속 추가 가능. 고른 곡만 `videos.list`로 길이까지 채워 저장.
- **링크 붙여넣기**: 유튜브 URL/ID를 직접 입력(`youtu.be`·`watch?v=`·`shorts`·순수 ID 파싱).
- 검색은 할당량(100 units)을 쓰므로 **오너 전용**으로 막아 둠.

### 재생 (공개)

- 곡 클릭 → 하단 고정 플레이어가 임베드 재생. 곡이 끝나면 **자동으로 다음 곡**.
- 컨트롤: 이전/다음/일시정지, **셔플 `⇄`**, **반복 `↻`(없음→전체→한 곡)**, 닫기.
- **진행 바(시크)**: 0.4초 폴링으로 재생 위치 표시 + 클릭/드래그로 이동, `현재/전체` 시간 표시
  (pointer 기반이라 마우스·터치 모두 지원).
- **셔플/반복 모델**: 셔플은 현재 곡을 유지한 채 나머지를 섞는 **순서(order) 기반**.
  전체 반복은 양 끝에서 순환, 한 곡 반복은 곡 종료 시 같은 곡을 다시 재생.
- **하이브리드 셔플 진입**: 각 재생목록 헤더의 "⇄ 셔플 재생"이 **전역 셔플 ON + 랜덤 첫 곡**으로
  그 목록을 시작한다(바의 셔플 토글과 같은 상태를 공유).
- 재생목록·곡 삭제로 현재 곡이 사라지면 플레이어를 닫는다.

### 페이지 전환에도 유지 (전역 플레이어)

- 재생 상태는 `contexts/PlaybackContext.jsx`(`usePlayback`)가 전역으로 보관하고,
  플레이어는 `Components/playlist/GlobalPlayer.jsx`로 **레이아웃(`NavigateLayout`)에 상주**한다.
  라우트 위에 mount되어 페이지를 옮겨도 **같은 인스턴스가 유지** → iframe/재생이 끊기지 않는다.
- 큐는 재생 시작한 목록의 곡 배열을 **스냅샷**으로 들고 있어, 다른 페이지로 가거나 목록을 편집해도 유지.
- 표시: `/playlist`에서는 **하단 전체 바(full)**, 그 외 페이지에서는 **우하단 미니 카드(mini)**.
  미니는 썸네일·제목·재생/다음·닫기·얇은 진행 바만 보이고, 제목 클릭 시 `/playlist`로 이동한다.

### 관리 (오너)

- 재생목록 생성/편집(제목·설명·accent)/삭제/순서(▲▼).
- 곡 메모(✎)/삭제(×)/순서(▲▼). 모든 쓰기는 `requireOwner`로 보호.

---

## 8. 데이터 관리 정책

- **라이브 데이터는 git 추적에서 분리**: `gallery.json`, `guestbook.json`, `playlists.json`,
  `uploads/`는 `.gitignore`. git 작업(checkout/reset 등)에 사용자 데이터가 덮이지 않도록.
- 기본값은 `*.seed.json`(커밋). 새 클론/파일 부재 시 store가 시드를 자동 복사.
- 백업이 필요하면 `server/src/data/*.json` + `server/uploads/`를 별도로 보관.

---

## 9. 환경변수 (server/.env)

```txt
OWNER_MATIAM_KEY=...   # 마티암오너 패스코드
OWNER_MIGEL_KEY=...    # 미겔오너 패스코드
YOUTUBE_API_KEY=...    # 플레이리스트 곡 추가/검색용 (YouTube Data API v3)
# PORT=8000            # 선택
```
`.env`는 git에 올리지 않으며(`.env.example`로 키 이름만 문서화), 변경 후 서버 재시작 필요.
`YOUTUBE_API_KEY`가 없어도 **재생/조회는 정상**이고, 곡 추가/검색만 막힌다.

---

## 10. 실행

```bash
# 클라이언트 (CRA, :3000)
cd client && npm install && npm start

# 서버 (Express, :8000)
cd server && npm install && npm start   # 또는 npm run dev (--watch)
```
프론트는 `REACT_APP_API_BASE`(기본 `http://localhost:8000`)로 서버에 연결합니다.

**프로덕션 배포**(Netlify + Railway 영구 볼륨): `docs/DEPLOY.md` 참고.

---

## 8. 디스코드 봇 (`bot/`)

둘만 쓰는 비공개 서버용. Railway 에 **별도 서비스**로 올린다(배포는 `DEPLOY.md` 9번).

### 원칙

- 사이트 데이터는 **HTTP API 로만** 다룬다. `server/src/services/*Store.js` 를 직접
  import 하지 않는다 — 파일 전체를 덮어쓰는 방식이라 락이 없고, 두 프로세스가 같이 쓰면
  갱신이 유실된다. (Railway Root Directory 가 `bot` 이라 물리적으로도 불가능하지만,
  로컬 개발 중 유혹이 실재한다.)
- 정적 콘텐츠(캐릭터·대사·세계관)는 `client/src/Data/` 가 원본이고,
  `bot/scripts/build-content.mjs` 가 평문 JSON 으로 뽑아 `bot/data/` 에 커밋한다.
  런타임에 `../client` 는 없다.
- 쓰기 권한은 디스코드 유저 ID → 오너 매핑으로 판단한다. 사이트 인증은 패스코드 두 개뿐이라
  서버는 "누가 썼는지" 를 모른다.

### 명령

| 명령 | 권한 | 쓰는 API |
|---|---|---|
| `/대사 오늘 · 랜덤 · 찾기` | 누구나 | 없음 (`bot/data/`) |
| `/그림 오늘 · 랜덤 · 태그` | 누구나 | `GET /api/gallery/*` |
| `/그림 올리기` | 오너 | `POST /api/gallery/images` (multipart) |
| `/영화 안쓴거 · 목록` | 누구나 | `GET /api/movie` |
| `/영화 평점 · 등록` | 오너 | `PATCH`/`POST /api/movie` (multipart) |
| `/플리 목록 · 보기` | 누구나 | `GET /api/playlist` |
| `/플리 곡추가 · 곡삭제 · 만들기 · 수정` | 오너 | `/api/playlist/*` (JSON) |
| `/플리 재생 · 지금 · 대기열 · 건너뛰기 · 섞기 · 반복 · 정지` | 누구나 | 없음 (yt-dlp) |
| `/캐입 말 · 초기화 · 사용량` | 누구나 | 없음 (Gemini) |
| `/주사위` `/뽑기` `/음성테스트` | 누구나 | 없음 |

### 알아둘 것

- **라우트마다 형식이 다르다.** 플레이리스트는 JSON, 갤러리·영화는 multipart —
  `express.json()` 이 라우트별로만 걸려 있어서다. 영화는 평점만 고쳐도 multipart 여야 한다.
- **영화 `ratings` 는 통째로 덮어쓴다**(`movieController.js:127`). 한 사람 것만 보내면
  상대방 평점이 날아간다. 봇은 읽기-병합-쓰기로 처리한다.
- **"한줄평 안 씀" 판정은 웹 UI(`Movie.js:53`)와 같은 술어**를 쓴다. 별점이 아니라 코멘트가
  비었는지로 본다 — 등록 다이얼로그가 별점을 기본 4로 채우기 때문.
- **오늘의 그림/대사는 날짜 고정**이다. 단순 `hash(날짜) % 길이` 로 하면 항목이 하나만
  늘어도 오늘 것이 바뀌므로, 항목마다 `(날짜, id)` 해시 점수를 매겨 최고점을 고른다.
- **캐입은 웹훅으로 답한다.** 웹훅을 만들 때 초상화를 아바타로 구워 넣는다 — 사이트 이미지는
  번들 해시가 붙어 빌드마다 파일명이 바뀌어 고정 URL 로 쓸 수 없기 때문.
- **음성 추출은 `bot/src/voice/ytsource.js` 한 곳에만** 있다. 가장 잘 깨지는 부분이라
  격리해 뒀다. 복구 순서는 `bot/README.md` 참고.
- **유튜브 검색은 yt-dlp 로** 한다. 사이트의 `/api/playlist/search` 는 호출당 쿼터를 100 쓰므로
  봇에서는 쓰지 않고, 쿼터는 곡 추가(1)에만 남긴다.
