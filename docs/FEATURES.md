# FEATURES

미하티(MIHEARTI)에 추가된 주요 기능과 백엔드 도입의 큰 흐름을 정리한 문서입니다.
(최종 갱신: 2026-09-09)

> 정적 페이지(Home/World/Character)에 이어, **갤러리·스토리 뷰어·방명록·플레이리스트·영화 기록**과
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
    ├── routes/                gallery.js · auth.js · guestbook.js · playlist.js · movie.js
    ├── controllers/           galleryController.js · guestbookController.js
    │                          playlistController.js · movieController.js
    ├── services/
    │   ├── storageService.js  로컬 저장 + 치수 측정 + 영상 poster(ffmpeg)
    │   ├── metaStore.js       gallery.json 읽기/쓰기 (없으면 seed 복사)
    │   ├── guestbookStore.js  guestbook.json 읽기/쓰기
    │   ├── playlistStore.js   playlists.json 읽기/쓰기 (없으면 seed 복사)
    │   ├── movieStore.js      movies.json 읽기/쓰기 (없으면 seed 복사)
    │   └── youtubeService.js  YouTube Data API v3 (videoId 추출 · 메타 조회 · 검색)
    └── data/
        ├── gallery.seed.json     기본 태그 시드 (커밋)
        ├── gallery.json          라이브 갤러리 데이터 (gitignore)
        ├── guestbook.json        라이브 방명록 데이터 (gitignore)
        ├── playlists.seed.json   빈 구조 시드 (커밋)
        ├── playlists.json        라이브 플레이리스트 데이터 (gitignore)
        ├── movies.seed.json      빈 구조 시드 (커밋)
        └── movies.json           라이브 영화 데이터 (gitignore)
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

# 영화 (조회 공개, 쓰기는 오너 — 전부 멀티파트)
GET    /api/movie                   전체 목록
POST   /api/movie                   (owner) 등록. poster(필수) + hoverPoster(선택)
PATCH  /api/movie/:id               (owner) 수정 — 평점만 고쳐도 멀티파트다
DELETE /api/movie/:id               (owner)
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

## 8. 영화 기록 (/movie)

둘이 같이 본 영화를 남기는 페이지. **심야 영화관 컨셉의 풀블리드 다크 모드**로,
다른 페이지의 양피지 톤과 일부러 다르게 간다.
`Pages/Movie.js` + `Components/movie/*` + `Styles/Movie.css`.

위에서 아래로: 네온사인 → (오너만) **코멘트가 필요한 영화** → **최근 본 영화**(캐러셀) →
**포스터 아카이브**(전체 그리드) → **관람 캘린더**. 포스터나 날짜를 누르면 티켓 모달이 열린다.

### 데이터 모델 (`movies.json`)

```txt
Movie { id, title, director, date('YYYY-MM-DD'), poster, hoverPosterImage?,
        ratings: { migel:{stars,comment}, matiam:{stars,comment} }, createdAt }
```
- **날짜당 한 편.** 클라이언트가 저장 버튼을 막고 서버가 409 로 한 번 더 막는다.
- `stars` 는 0~5, 0.5 단위. `comment` 는 서버에서 300자로 자른다.
- 오너 이름·색은 `Data/movies.js` 의 `movieOwners` 가 갖는다(겨울/사백 + 색).
  정적 영화 배열은 비어 있다 — **화면에 보이는 것은 전부 API 에서 온다.**

### 포스터 캐러셀

- 트랙을 옮기는 대신 카드마다 **원형 최단거리 offset** 을 CSS 변수로 넘기고 CSS 가 위치를
  잡는다(`translateX(offset × 190px)` + `scale`/`opacity`). 끝에서 처음으로 넘어갈 때
  되감기가 없다.
- 3.5초마다 자동 회전하되 **카드에 마우스를 올리면 멈춘다.** `hoverPosterImage` 가 있으면
  올렸을 때 그 이미지로 바뀐다.
- 가운데 카드를 누르면 티켓이 열리고, 옆 카드를 누르면 그 카드가 가운데로 온다.

### 관람 캘린더

- 날짜 → 영화를 `YYYY-MM-DD` 문자열 키로 찾는다.
- **처음 보여 주는 달은 오늘이 아니라 가장 최근 영화가 있는 달**이다. 기록을 보러 온
  페이지에서 빈 이번 달을 띄울 이유가 없다.
- 오너에게만 칸 위에 `편집` 알약이 뜬다(전체 정보 수정 다이얼로그로 간다).

### 티켓 모달

영화를 **극장 티켓**으로 그린다 — 본권(포스터·제목·감독·관람일·양쪽 별점) + 점선 절취선 +
`ADMIT TWO` 부본(바코드, id 뒤 6자리로 만든 일련번호).

- 커서 위치를 최대 **8도** 기울기로 바꾼다. **편집 중에는 끈다** — 입력하는데 판이 흔들리면 안 된다.
- 별점·코멘트만 이 자리에서 고치고, 제목·포스터 같은 나머지는 캘린더의 `편집` 으로 간다.
- `z-index: 10000`. 네비게이션 바가 9999 라, 그 위로 올려야 상단 닫기(×)가 안 가린다.
  추가/수정 다이얼로그는 다시 그 위(10001).

### 오너 전용

`+ 영화 추가`, 캘린더 `편집`, 티켓의 `별점·코멘트 수정`·`삭제`, 그리고
**코멘트가 필요한 영화** 구역 전체. 마지막 것은 **지금 로그인한 오너 기준**으로,
자기가 한줄평을 안 쓴 영화만 모아 준다.

### 알아둘 것

- **"안 씀" 판정은 별점이 아니라 코멘트가 비었는지로 한다.** 등록 다이얼로그가 별점을
  기본 4로 채우기 때문에 별점으로 보면 전부 "썼음" 이 된다.
- **`ratings` 는 통째로 덮어쓴다.** 한쪽만 보내면 상대 평점이 날아간다. 웹 UI 는 항상 둘 다
  보내지만, 봇처럼 밖에서 고칠 때는 읽기-병합-쓰기를 해야 한다(12번 참고).
- **평점만 고쳐도 멀티파트다.** 라우트가 multer 뒤에 있어 `express.json()` 이 안 걸려 있다.
- `Movie.css` 는 `.movie` 에만 `overflow: hidden` 을 준다(`.content` 는 안 건드린다 —
  ARCHITECTURE 의 sticky 규약). 캐러셀 카드가 화면 밖으로 나가므로 이 clip 이 필요하고,
  대신 **`.movie` 안에서는 `position: sticky` 를 쓸 수 없다.**
- **반응형 기준이 표준(375/767/1023/1024)과 다르다.** 이 페이지만 480/600/620 에서 꺾인다.
  손볼 때 알고 있어야 한다.
- 서버가 죽어 있으면 **아무 말 없이 빈 페이지**가 된다(`.catch(() => {})`). 정적 폴백이
  없어져서 네온사인만 남는다.
- CSS 변수 이름이 값과 안 맞는다. `--mv-green` 은 실제로 붉은 주황(`#e2472f`)이고
  `--mv-green-core` 는 청록이다. 이름만 보고 고치지 말 것.

---

## 9. 데이터 관리 정책

- **라이브 데이터는 git 추적에서 분리**: `gallery.json`, `guestbook.json`, `playlists.json`,
  `movies.json`, `uploads/`는 `.gitignore`. git 작업(checkout/reset 등)에 사용자 데이터가 덮이지 않도록.
- 기본값은 `*.seed.json`(커밋). 새 클론/파일 부재 시 store가 시드를 자동 복사.
- 백업이 필요하면 `server/src/data/*.json` + `server/uploads/`를 별도로 보관.

---

## 10. 환경변수 (server/.env)

```txt
OWNER_MATIAM_KEY=...   # 마티암오너 패스코드
OWNER_MIGEL_KEY=...    # 미겔오너 패스코드
YOUTUBE_API_KEY=...    # 플레이리스트 곡 추가/검색용 (YouTube Data API v3)
# PORT=8000            # 선택
```
`.env`는 git에 올리지 않으며(`.env.example`로 키 이름만 문서화), 변경 후 서버 재시작 필요.
`YOUTUBE_API_KEY`가 없어도 **재생/조회는 정상**이고, 곡 추가/검색만 막힌다.

---

## 11. 실행

```bash
# 클라이언트 (CRA, :3000)
cd client && npm install && npm start

# 서버 (Express, :8000)
cd server && npm install && npm start   # 또는 npm run dev (--watch)
```
프론트는 `REACT_APP_API_BASE`(기본 `http://localhost:8000`)로 서버에 연결합니다.

**프로덕션 배포**(Netlify + Railway 영구 볼륨): `docs/DEPLOY.md` 참고.

---

## 12. 디스코드 봇 (`bot/`)

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
| `/플리 듣기` | 누구나 | `GET /api/playlist` (링크만 만든다) |
| `/캐입 말 · 초기화 · 사용량` | 누구나 | 없음 (Gemini) |
| `/요트 시작 · 판 · 그만` | 누구나 | 없음 (Gemini) |
| `/블랙잭 시작 · 판 · 그만` | 누구나 | `GET /api/accounts` · `POST /deltas` |
| `/홀덤 시작 · 판 · 족보 · 그만` | 누구나 | `GET /api/accounts` · `POST /deltas` |
| `/홀덤 토너먼트` | 누구나 | `POST /deltas` (끝에 한 번 + MT) |
| `/홀덤 던전` | 누구나 | `POST /deltas` (핸드마다 체력, 이기면 아이템 · 열 때 도감에 만남) |
| `/에너미 도감` | 누구나 | `GET /api/accounts` (만난 에너미만 이름이 열린다) |
| `/양도` | 누구나 | `GET /api/accounts` · `POST /deltas` (보내는 쪽 −, 받는 쪽 + 한 번에) |
| `/출첵` | 누구나 | `POST /api/accounts/claim` |
| `/급여` | 누구나 | `POST /api/accounts/deltas` |
| `/프로필` | 누구나 | `GET /api/accounts` · `POST /accounts/title` (카드·전적·칭호·아이템 탭) |
| `/요트` 1위 | — | `POST /api/accounts/deltas` (MT +1) |
| `/아이템 정보` | 누구나 | 없음 (명부가 코드 안에 있다) |
| `/상점 사기 · 팔기` | 누구나 | `GET /api/accounts` · `POST /deltas` (에페메랄) |
| `/사용` | 누구나 | `GET /api/accounts` · `POST /deltas` |
| `/요리` · `/제작` | 누구나 | 제미나이 1회 · `GET /api/accounts` · `POST /deltas` (재료 −, crafts +) |
| `/mt상점` | 누구나 | `GET /api/accounts` · `POST /deltas` (칭호: MT −, own 카운터 + / 바꾸기: crafts −, MT +) · `POST /accounts/title` (에페메랄) |
| `/주사위` `/뽑기` | 누구나 | 없음 |

`판` 은 판을 아래에 다시 띄우고, `그만` 은 **판에 앉은 사람이나 판을 연 사람만** 접을 수 있다.

### 게임 (`/요트` · `/블랙잭` · `/홀덤`)

셋 다 **스레드에서 돈다.** 주사위·카드·대사가 오가는 통에 원래 채널이 묻히지 않게.

- **요트 다이스** — 한국식 12칸(포카드·풀하우스가 서양 Yahtzee 와 다르게 **눈 다섯 개의 합**).
  최대 4자리, 두 자리부터 시작한다. 미겔·마티암을 NPC 로 부를 수 있다.
  끝까지 둔 판에서 **1위가 한 명이면 MT 한 개**. 동점이면 안 준다.
- **블랙잭** — 카지노 "bard" 이고 **미겔이 딜러**다. 미겔을 손님 자리에 앉히면 `npc` 가
  딜러를 맡는다(이름과 얼굴이 따로 있다). 최대 4자리, 혼자서도 시작된다.
  6덱 S17 · 3:2 · Split · Double · Insurance · Surrender 전부 있다.
- **홀덤 토너먼트**(`/홀덤 토너먼트`) — **한 명이 남을 때까지.** 넷부터(모브 자리 포함) 시작하고 블라인드가
  6핸드마다 오른다 — 다만 남은 사람 평균 칩이 15BB 아래로 떨어질 칸이면 멈추고 15핸드마다만
  오른다(끝판이 운 싸움이 되지 않게). 사람이 [다음 핸드] 를 안 눌러도 저절로 넘어간다. 우승자가 판의 칩을 다 가져가고, **MT 는 1위 둘 · 2위 하나**. `모브:` 로 에너미를 앉힐 수 있다 —
  에너미의 칩도 따면 골드가 되고, 에너미에게 지면 그만큼 에너미가 가져간다.
  지난 핸드의 결과는 다음 핸드로 넘어가도 채널에 남는다(새 핸드는 아래에 새로 뜬다).
- **던전**(`/홀덤 던전`) — 에너미와 **단둘이, 체력을 걸고.** 스택이 곧 체력이고
  블라인드는 2/4 에서 시작해 **6핸드마다 오른다**(토너먼트와 같은 사다리) — 버티기만 해서는
  판이 안 끝나게. 한쪽이 0 이 되면 끝, 0 이 된 쪽은 쓰러진다.
  **쓰러지는 것은 체력이 0 일 때뿐이다** — 도망·방치·접기로 끝난 판은 남은 체력 그대로 나온다. 핸드 사이에 도망칠 수
  있고, 미겔·마티암을 불러 **자기 체력으로** 대신 싸우게 할 수 있다.
  **누구도 들어올 때 체력보다 강해지지 않는다** — 60 으로 들어가면 이겨도 계정은 60 까지만
  돌아오고, 적도 시작 체력을 넘긴 몫은 흩어진다. 이쪽이 넘긴 몫은 **판 안에서는 그대로 걸 수
  있고**, 판이 끝날 때(이김·도망·방치) 한 번에 **체력 1 = 2골드**로 바뀐다(미겔·마티암 몫은
  오너 치료 → 아이템).
  이기면 **잡화·골드·드물게 MT** 를 주워 온다 — 엘리트를 눕히면 가짓수도 값도 MT 확률도 오른다.
  상대는 **일반 에너미 40종**(체력 30~60)이 기본이고 **다섯에 한 번 엘리트**(100~160)가 나온다.
- **텍사스 홀덤** — 노리밋. **최대 8자리**(요트·블랙잭은 넷), 두 자리부터. 판돈 등급은 마이크로·로우·미들·하이
  넷이고 기본은 로우(블라인드 10/20 · 앉으면 50BB).
  `모브:3` 으로 **엘리트 에너미**를 앉힐 수 있다 — 지갑 없이 매번 다른 스택으로 오고,
  성향은 「모험 일지」의 설명에서 뽑았다. 대사는 `폴드`·`20 레이즈` 처럼 수만 말한다.
  홀덤에는 딜러석이 없어서(카드는 봇이 돌린다) **미겔도 손님으로 앉고**, 판을 여는 인사만
  bard 주인으로서 겸한다. 레이즈 금액은 최소·½팟·팟·올인 버튼으로 고른다.

블랙잭·홀덤의 골드는 **서버에 영구 저장된다.** 두 게임이 한 잔액을 나눠 쓰고 판이 끝나도
남는다. 자세한 것은 [CASINO_GOLD.md](CASINO_GOLD.md).

공통 배관은 이렇다.

- 판은 **항상 `message.edit()` 로 고친다.** `interaction.editReply()` 는 토큰이 15분이면
  죽는데 한 판은 그걸 훌쩍 넘긴다.
- 상태 변경은 `await` **앞에서 동기로** 끝내고, `customId` 의 `rev` 로 지나간 클릭을 거른다.
  디스코드가 누른 버튼을 비활성화해 주지 않아서, 빠르게 두 번 누르면 두 번 들어온다.
- NPC 차례·딜러 진행·정산은 **드라이버**(인터랙션 응답 경로 밖)에서 돈다. 대사도 전부 거기서
  나간다 — 웹훅은 느려서 응답 경로에 두면 3초 시한을 갉아먹는다.
- 주사위·카드는 **앱 이모지**다(앱당 2000개, 서버 슬롯을 안 먹는다). 그림은
  `bot/scripts/make-{dice,card}-emoji.mjs` 가 만들어 API 로 바로 올린다. 없으면 키캡 숫자와
  `**A**♠️` 로 물러선다.
- 10분 방치되면 판이 저절로 닫힌다. **봇이 재시작하면 진행 중이던 판은 사라진다**(메모리에만 있다).

**대사**는 게임마다 정책이 다르다. 요트는 Gemini 로만 짓고 실패하면 그냥 비운다.
카지노 두 게임은 한 핸드에 대사 자리가 훨씬 많아 전부 API 로 갈 수 없으므로,
**Gemini 로 먼저 지어 보고 안 되면 손으로 쓴 줄로 물러선다**
(`casino-lines.json` 600여 줄 · `holdem-lines.json` 118줄).
한도가 찼든 API 가 죽었든 판은 늘 말이 있는 채로 돈다.
프롬프트는 `ai/casinoTalk.js` 하나가 게임 이름을 받아 갈라 쓴다.

### 홀덤에만 있는 것 — 숨은 정보

앞의 두 게임은 판이 전부 공개였지만 홀덤은 **각자 두 장을 자기만 본다.**
봇이 한 사람에게만 보낼 수 있는 길은 **그 사람이 누른 인터랙션에 ephemeral 로 답하는
것** 하나뿐이라(DM 은 막아 둔 사람이 못 받는다) `[내 패]` 버튼으로 풀었다.
그래서 이 버튼만 `deferUpdate` 경로를 안 탄다 — 한 인터랙션에 `deferUpdate` 와 `reply`
를 둘 다 할 수 없다.

**샐 수 있는 자리가 셋이고 셋 다 막아야 한다.**

| 어디 | 어떻게 |
|---|---|
| 판(임베드) | 홀 카드를 아예 안 그린다. 자리 표는 골드·베팅·방금 한 행동만 |
| 쇼다운 | 끝까지 간 사람만 깐다. 전원이 폴드해 한 명만 남으면 아무도 안 깐다 |
| **대사 메모** | 화자별로 만든다 — 자기 패만 넣는다. **화면에는 안 보이는데 모델에게만 새는 길이라 제일 놓치기 쉽다** |

그 밖에 홀덤에만 있는 것들.

- 팟을 나눌 때 **남는 골드는 버튼 왼쪽부터 한 골드씩.** 내림으로 버리면 골드가 사라진다.
- **`CHIP_UNIT`(50)을 안 쓴다.** 그 상수는 블랙잭의 3:2 배당 때문에 있는 것이고 포커는
  정수면 된다. 그래서 홀덤 뒤 잔액이 50의 배수가 아닐 수 있는데, 블랙잭 올인이 내림하므로
  그 나머지는 못 걸 뿐 사라지지 않는다.
- 덱은 **핸드마다 한 벌을 새로 섞는다.** 블랙잭처럼 6덱 슈를 이어 쓰면 같은 카드가 두 장
  나와 플러시·페어 판정이 깨진다.
- 노리밋의 금액 입력은 **Raise → 최소·½팟·팟·올인** 2단계 버튼이다. 모달을 쓰면
  `index.js` 가 `isModalSubmit` 을 안 봐서 라우팅부터 손봐야 한다.
- NPC 는 **상대 손을 읽지 않는다.** 대신 이번 핸드에 상대가 얼마나 세게 나왔는지로
  그 사람 시작패의 문턱을 정하고, 몬테카를로에서 그 문턱을 넘는 패만 배분한다.
  거르는 것이 시작 두 장의 세기뿐이라 **효과가 손마다 다르다** — 큰 카드에 밀리는
  어중간한 손은 승률이 43%→21% 로 크게 떨어지지만 이미 센 손은 거의 안 움직인다.
  핸드를 넘겨 기억하지는 않는다(상대별 학습 없음).

**검증 도구가 둘 있다.** `scripts/check-poker.mjs` 는 핸드 평가기를(손으로 고른 사례 +
무작위 2만 판, 카테고리 분포를 실제 확률과 대조), `scripts/simulate-holdem.mjs` 는
규칙을 본다(**골드 총합 보존**과 베팅 라운드가 닫히는지).
`scripts/check-reads.mjs` 는 위의 상대 읽기가 실제로 값을 바꾸는지 잰다 — 안 돌아도
승률은 그럴듯한 숫자로 나와서 조용히 망가지기 쉬운 자리다. 사이드팟과 찹이 이 게임에서 제일
틀리기 쉬운 곳이라 총합 검사가 그걸 잡는 장치다 — 실제로 "자격자가 아무도 없는 팟 층"
버그를 여기서 찾았다.

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
- **봇이 음성 채널에서 직접 트는 기능은 뺐다.** 유튜브가 데이터센터 IP 를 차단해
  Railway 에서 안정적으로 동작하지 않았고(쿠키로도 40분을 못 버텼다), 추출 도구를 두는 것
  자체가 호스트 약관에 걸릴 소지가 있었다. `/플리 듣기` 가 사이트·유튜브 링크로 안내한다.
  사유와 복구 방법은 `bot/README.md` 참고.
- **유튜브 검색 명령은 두지 않는다.** 사이트의 `/api/playlist/search` 는 호출당 쿼터를 100 쓴다.
  쿼터는 곡 추가(1)에만 남기고, 곡은 링크를 직접 붙여 넣어 추가한다.

### 아직 안 만든 것

- **`/상점` · `/요리` · `/아이템 양도` · `/상호작용`.** 계정 레코드의 `items` 자리는
  이미 뚫려 있고 `/프로필` 이 그 자리를 보여준다 — 늘 비어 있을 뿐이다.
  골드 양도는 `/아이템 양도` 에서 골드를 골라 개수를 정하는 형태로 들어가고, 대상에는
  미겔·마티암도 포함된다(미겔↔마티암도). 뽑기·요리·상점 **칭호**도 같은 명부
  (`bot/src/casino/titles.js`)에 조건 한 줄로 붙는다.
  자세한 것은 [CASINO_GOLD.md](CASINO_GOLD.md).
