# ARCHITECTURE

미하티(MIHEARTI) 프로젝트의 현재 구조와 규약을 정리한 문서입니다.
리팩터링 진행에 따라 갱신합니다. (최종 갱신: 2026-09-08)

> 이 문서는 **client/src(프론트엔드) 구조와 규약**을 다룹니다.
> 갤러리·스토리·방명록 등 기능 흐름과 **백엔드(Express API)** 는 `FEATURES.md` 참고.

## 폴더 구조 (client/src)

```
client/src/
├── Assets/
│   ├── Font/            폰트 (Pretendard, NexonWarhaven, OldLondon, Quentin, Hahmlet)
│   │   ├── optimized/   ★ 실제로 참조하는 woff2 (scripts/optimize-fonts.py 산출물)
│   │   └── ttf|otf|woff|woff2/  원본 — 재변환 소스로만 보관, 직접 참조 금지
│   └── Images/          이미지 (webp 우선, png/jpg/svg 병존; story/ 삽화)
├── Components/
│   ├── common/
│   │   └── InfoItem.jsx          라벨/값 정보 항목 (CharacterPanel에서 사용)
│   ├── gallery/                  갤러리 UI
│   │   ├── GalleryGrid.jsx       균형 메이슨리 + 무한스크롤
│   │   ├── GalleryCard.jsx       카드(IO 지연로딩, 앨범/영상 배지)
│   │   ├── GalleryModal.jsx      확대/앨범 캐러셀/다운로드/태그편집
│   │   ├── TagFilterBar.jsx      태그 필터 + 관리(추가/이름변경/삭제/순서)
│   │   ├── TagInput.jsx          노션식 태그 입력
│   │   ├── UploadDialog.jsx      다중 업로드 + 앨범 묶기 토글
│   │   └── galleryLayout.js      카드 비율 정책(MAX_CARD_RATIO)
│   ├── guestbook/
│   │   └── Guestbook.jsx         방명록(작성/목록 + 스팸방지)
│   ├── playlist/                 플레이리스트 UI
│   │   ├── GlobalPlayer.jsx      레이아웃 상주 플레이어(full/mini 선택)
│   │   ├── MusicPlayer.jsx       플레이어 본체(YouTube IFrame, 시크/셔플/반복)
│   │   ├── PlaylistSection.jsx   재생목록 한 묶음(제목/곡 목록/오너 컨트롤)
│   │   ├── TrackRow.jsx          곡 한 줄(썸네일·재생·메모/삭제/정렬)
│   │   ├── PlaylistDialog.jsx    재생목록 생성/편집
│   │   ├── AddTrackDialog.jsx    곡 추가(이름 검색 / 링크)
│   │   ├── useYouTubeIframeApi.js  IFrame API 1회 로드 훅
│   │   └── playlistUtils.js      길이 포맷
│   ├── story/
│   │   └── StoryTimeline.jsx     스토리 상단 타임라인
│   ├── NavigationBar.js
│   ├── ScrollToTop.js
│   └── StickyRevealLines.js
├── contexts/
│   ├── OwnerContext.jsx          오너 권한 전역 상태 (useOwner)
│   └── PlaybackContext.jsx       음악 재생 전역 상태 (usePlayback, 페이지 전환에도 유지)
├── services/                     API/저장소 접근 계층
│   ├── galleryApi.js             /api/gallery/* (상대→절대 url 변환)
│   ├── guestbookApi.js           /api/guestbook/*
│   ├── playlistApi.js            /api/playlist/* (재생목록/곡/검색)
│   └── ownerAuth.js              오너 패스코드(localStorage) + 검증
├── Data/
│   ├── Characters.js    캐릭터 데이터 (색상/이미지는 constants 참조)
│   ├── world.js         World 페이지 콘텐츠 (순서 있는 본문 블록 배열)
│   ├── stories.js       스토리 본문 (scripts/TSV에서 생성)
│   ├── storyImages.js   스토리 삽화 매핑
│   └── constants/       중앙 상수
│       ├── colors.js        캐릭터/테마 색상
│       ├── images.js        이미지 import → 번들 URL 제공
│       └── breakpoints.js   반응형 기준값 + getBreakpoint()
├── Layouts/
│   └── NavigateLayout.js
├── Pages/
│   ├── Home.js          (하단에 방명록 포함), World.js
│   ├── CharacterHub.js, CharacterPanel.js
│   ├── Story.js         스토리 책 뷰어 (구현)
│   ├── Gallery.js       갤러리 (/image, 구현)
│   └── Playlist.js      플레이리스트 (/playlist, 구현)
├── Styles/
│   ├── theme.css        CSS 변수(색상/폰트/spacing), 기본 리셋
│   ├── global.css       전역 요소 스타일, .content 래퍼
│   ├── App.css, Home.css, World.css, Character.css, Components.css
│   └── Story.css, StoryBook.css, Gallery.css, Guestbook.css, Playlist.css
├── App.js               라우터(+ OwnerProvider) + CSS 로딩 진입점
└── index.js
```

> 갤러리/방명록/플레이리스트의 실데이터는 프론트가 아니라 **서버(Express)** 가 보관합니다.
> 갤러리·태그·미디어는 `gallery.json` + `uploads/`, 방명록은 `guestbook.json`,
> 플레이리스트는 `playlists.json`(유튜브 메타 캐싱).
> 정적 콘텐츠(캐릭터/월드/스토리)만 `Data/*.js`로 관리합니다. (상세: FEATURES.md)

## CSS 로딩 계층 (App.js 기준)

순서가 cascade 우선순위를 결정하므로 **이 순서를 유지**합니다.

```
theme.css   → CSS 변수, 리셋 (가장 먼저)
global.css  → 전역 요소/유틸
Font.css    → @font-face
App.css     → 기존 전역 스타일
(+ 각 페이지/기능 CSS는 해당 컴포넌트에서 import)
```

### 주의: position: sticky 와 overflow

- 조상 요소에 `overflow-x: hidden`을 주면 브라우저가 `overflow-y`를 `auto`로
  계산해 그 요소가 **스크롤 컨테이너**가 된다. 그러면 자식의 `position: sticky`가
  뷰포트가 아니라 그 조상 기준으로 묶여 **고정 동작이 깨진다.**
- 따라서 `.content`(sticky 자식을 가짐)에는 overflow를 주지 않는다.
  가로 스크롤 차단은 `html` 또는 페이지 단위(`.hub`, `.world-content`)에서 처리한다.
- Home의 "MIHEARTI" 축소/고정 효과가 이 규칙에 의존한다.

## 상수 관리 (Data/constants)

- **colors.js** — 캐릭터 고유색은 `primary` 하나로 단일화.
  `characterColors.migel.primary`, `themeColors.*`.
- **images.js** — CRA(webpack)에서는 `src/Assets` 이미지를 문자열 경로로 못 쓰므로
  반드시 `import`해서 번들 URL을 만든다. 이 파일이 래스터 이미지(webp)의 단일 출처.
  단, 인라인으로 쓰는 SVG(ReactComponent)는 각 컴포넌트에서 직접 import.
- **breakpoints.js** — 기준값(375/767/1023/1024)과 `getBreakpoint()`.
  현재는 참고용이며 CSS는 아직 리터럴 px을 사용.

### 이미지 최적화 규약

- 프론트는 Netlify(CDN)에 정적 배포되므로 이미지는 **레포에 두고 번들에 태우는 것이 가장 빠르다.**
  Railway(백엔드)는 단일 리전 컨테이너라 정적 이미지 원본으로 쓰면 오히려 느려진다.
  서버가 서빙하는 건 사용자가 올린 갤러리 미디어(`/uploads`)뿐이다.
- 그래서 성능은 저장 위치가 아니라 **파일 용량**으로 결정된다. 새 이미지를 추가할 땐
  `client/scripts/optimize-images.mjs` 의 TARGETS 에 등록하고 실행해 webp 를 만든 뒤,
  코드/CSS 는 **webp 만 참조**한다. 원본(png/jpg)은 재변환용으로 남겨 두되 import 하지 않는다.

  ```bash
  cd client && node scripts/optimize-images.mjs
  ```

  maxWidth 는 "CSS 표시 폭 × 2(레티나)" 기준. 표시 폭은 **추정하지 말고 실측한다** —
  1920 뷰포트에서 `[...document.querySelectorAll('img')].map(i => [i.src, i.clientWidth, i.naturalWidth])`
  로 재면 어떤 이미지가 몇 배 과한지 바로 나온다(포트레이트가 15배까지 과했다).
  예외: `img_background` 는 `background-size: 100% auto` 라 뷰포트 폭 그대로 쓰므로 2x 를 적용하지 않고,
  세부가 많은 사진은 2x 를 채우면 용량이 급증해 1.4x 선에서 타협한다(`img_J4Wphoto`).
- `<img>` 에는 원본 픽셀 크기를 `width`/`height` 로 적어 비율을 알려주고(레이아웃 밀림 방지),
  첫 화면 밖 이미지엔 `loading="lazy" decoding="async"` 를 붙인다.

### 폰트 최적화 규약

- **참조는 `Assets/Font/optimized/` 의 woff2 만.** 원본(ttf/otf/woff/woff2)은 재변환
  소스로 남겨 두고 `Font.css` 에서 직접 가리키지 않는다. 폰트를 추가·교체할 땐
  `scripts/optimize-fonts.py` 의 TARGETS 에 등록하고 실행한다.

  ```bash
  cd client && python scripts/optimize-fonts.py   # 사전: pip install fonttools brotli
  ```

- **모든 `@font-face` 에 `font-display: swap`.** 없으면 브라우저가 최대 3초간 글자를
  아예 그리지 않는다. NexonWarhaven 은 거의 모든 페이지에서 쓰이므로 특히 중요하다.
- **woff 폴백은 두지 않는다.** browserslist 프로덕션 대상은 전부 woff2 를 지원해서
  내려받지도 않으면서 배포 용량만 차지했다.
- **실제로 쓰는 웨이트만 선언한다.** Pretendard 400/600/700/800, NexonWarhaven 400/700,
  Hahmlet 400/700. 선언만 해 둔 웨이트는 내려받지는 않지만 산출물을 무겁게 한다.
- **서브셋은 Pretendard 에만 적용한다.** 방명록·갤러리처럼 사용자가 입력한 글자가
  렌더링되는 폰트(NexonWarhaven / Hahmlet)는 글리프를 하나도 버리지 않는다.
  Pretendard 로 그려지는 한글은 레포 안 정적 텍스트뿐이라 안전하고, 이미 woff2 여서
  재압축 여지가 없어(721KB → 721KB) 글자 수를 줄이는 것 말고는 방법이 없었다.
  상용 집합의 정의와 근거는 스크립트 상단 주석 참고.

## 반응형 규약

- 표준 breakpoint: `375`(verySmall) / `767`(mobile) / `1023`(tablet) / `1024+`(desktop).
- 기존 페이지에는 1500/1000 등 비표준 breakpoint가 남아 있다. 제거하지 않고
  필요 시 `max-width: 767px` 블록을 **추가**하는 방식으로 모바일을 보정한다.
- iOS Safari 동적 툴바 대응: `100vh` 대신 `@supports (height: 100dvh)` 안에서
  `dvh`로 덮어쓴다. (미지원 브라우저는 기존 `vh` 유지)
- World의 잡지(float) 레이아웃: 데스크톱은 float 유지(텍스트 감싸기), 모바일
  (≤767px)에서만 `float: none; width: 100%`로 세로 스택. float→flex 전면 교체는
  텍스트 감싸기를 깨므로 하지 않는다.

## 클래스 소유권 메모

- `.info-item` / `.label` / `.value` 는 **Character.css가 소유**한다.
  특히 `.value { white-space: pre-line }` 가 캐릭터 본문 줄바꿈에 필수이므로,
  전역 CSS에서 같은 클래스를 재정의하지 않는다(cascade 충돌 방지).
