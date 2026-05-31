# ARCHITECTURE

미하티(MIHEARTI) 프로젝트의 현재 구조와 규약을 정리한 문서입니다.
리팩터링 진행에 따라 갱신합니다. (최종 갱신: 2026-05-31)

## 폴더 구조 (client/src)

```
client/src/
├── Assets/
│   ├── Font/            폰트 (Pretendard, NexonWarhaven, OldLondon, Quentin, Hahmlet)
│   └── Images/          이미지 (webp 우선, png/jpg/svg 병존)
├── Components/
│   ├── common/          공통 재사용 컴포넌트 (신규)
│   │   ├── InfoItem.jsx          라벨/값 정보 항목 (CharacterPanel에서 사용 중)
│   │   ├── ArticleContainer.jsx  반응형 콘텐츠 컨테이너 (아직 미적용)
│   │   └── ResponsiveImage.jsx   aspect-ratio 기반 반응형 이미지 (아직 미적용)
│   ├── NavigationBar.js
│   ├── ScrollToTop.js
│   └── StickyRevealLines.js
├── Data/
│   ├── Characters.js    캐릭터 데이터 (색상/이미지는 constants 참조)
│   └── constants/       신규: 중앙 상수
│       ├── colors.js        캐릭터/테마 색상
│       ├── images.js        이미지 import → 번들 URL 제공
│       └── breakpoints.js   반응형 기준값 + getBreakpoint()
├── Layouts/
│   └── NavigateLayout.js
├── Pages/
│   ├── Home.js, World.js
│   ├── CharacterHub.js, CharacterPanel.js
│   └── Story.js, ImageView.js, Playlist.js  (미구현)
├── Styles/
│   ├── theme.css        신규: CSS 변수(색상/폰트/spacing), 기본 리셋
│   ├── global.css       신규: 전역 요소 스타일, .content 래퍼
│   ├── layout.css       신규: 공통 레이아웃 클래스
│   ├── App.css, Home.css, World.css, Character.css, Components.css
│   └── index.css
├── App.js               라우터 + CSS 로딩 진입점
└── index.js
```

## CSS 로딩 계층 (App.js 기준)

순서가 cascade 우선순위를 결정하므로 **이 순서를 유지**합니다.

```
theme.css   → CSS 변수, 리셋 (가장 먼저)
global.css  → 전역 요소/유틸
layout.css  → 공통 레이아웃 클래스
Font.css    → @font-face
App.css     → 기존 전역 스타일
(+ 각 페이지 CSS는 페이지 컴포넌트에서 import)
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

## 클래스 소유권 메모

- `.info-item` / `.label` / `.value` 는 **Character.css가 소유**한다.
  특히 `.value { white-space: pre-line }` 가 캐릭터 본문 줄바꿈에 필수이므로,
  layout.css 등 전역에서 같은 클래스를 재정의하지 않는다(cascade 충돌 방지).
