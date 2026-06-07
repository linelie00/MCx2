# ARCHITECTURE

미하티(MIHEARTI) 프로젝트의 현재 구조와 규약을 정리한 문서입니다.
리팩터링 진행에 따라 갱신합니다. (최종 갱신: 2026-06-08)

> 이 문서는 **client/src(프론트엔드) 구조와 규약**을 다룹니다.
> 갤러리·스토리·방명록 등 기능 흐름과 **백엔드(Express API)** 는 `FEATURES.md` 참고.

## 폴더 구조 (client/src)

```
client/src/
├── Assets/
│   ├── Font/            폰트 (Pretendard, NexonWarhaven, OldLondon, Quentin, Hahmlet)
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
