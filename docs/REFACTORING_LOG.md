# REFACTORING LOG

리팩터링 작업 기록. 기능/디자인 분위기는 유지하면서 구조 정리 + 아이폰 반응형을
목표로 진행한다.

---

## 2026-05-31

### 1단계 — 기반 구조 추가 (신규 파일만, 기존 동작 영향 없음)
- `Data/constants/colors.js` : 캐릭터/테마 색상 중앙화.
- `Data/constants/images.js` : 이미지 import → 번들 URL 중앙 제공.
- `Data/constants/breakpoints.js` : 반응형 기준값 + `getBreakpoint()`.
- `Styles/theme.css` / `global.css` / `layout.css` : CSS 변수·전역·공통 레이아웃.
- `Components/common/InfoItem.jsx`, `ArticleContainer.jsx`, `ResponsiveImage.jsx` : 공통 컴포넌트.
- `App.js` : CSS 로딩 순서 정리(theme → global → layout → Font → App).
- **이유**: 색상/이미지/breakpoint의 단일 출처 확보, 공통 UI 재사용 기반 마련.

### 색상 구조 단순화
- `colors.js`, `theme.css` 에서 `accent`/`bg` 제거 → 캐릭터당 `primary` 하나로 단일화.
- **이유**: "캐릭터 = 대표색 1개"로 의미를 단순화(요청 반영).
- 참고: NavigationBar의 기존 강조색(`#d3b6a1`, `#0e7741`)은 Components.css에
  네비 전용 스타일로 하드코딩 상태로 남아 있음.

### 2단계 — 데이터 연결
- `Data/Characters.js` : 하드코딩 색상값 → `characterColors.*.primary` 참조.
- `Data/Characters.js` : 개별 이미지 import 6줄 제거 → `images.characters.*` 참조.
- `Data/constants/images.js` : 문자열 파일명 → 실제 webpack `import`로 재작성
  (CRA에서 문자열 경로는 동작하지 않으므로).
- **이유**: 색상·이미지 단일 출처화. 값은 동일 → 시각적 변화 없음. 빌드 검증 완료.

### 회귀 수정 — Home의 "MIHEARTI" 스크롤 고정/축소
- `global.css` : `.content` 에서 `overflow-x: hidden` 제거.
- `theme.css` : `html` 에서 `scroll-behavior: smooth` 제거.
- **이유**: 1단계에서 추가했던 두 속성이 sticky 고정을 깨고(overflow→스크롤 컨테이너화)
  스크롤 기반 JS 애니메이션을 어색하게 만들었음. 원래 동작으로 복원.
  (자세한 메커니즘은 ARCHITECTURE.md "position: sticky 와 overflow" 참고)

### 3단계 — Character 페이지 반응형 + InfoItem 적용
- `Pages/CharacterPanel.js` : 로컬 `InfoItem` 제거 → 공통 컴포넌트 import.
- `Styles/layout.css` : 충돌하던 `.info-item/.label/.value` 전역 규칙 제거
  (Character.css가 소유, `white-space: pre-line` 줄바꿈 보존).
- `Styles/Character.css` (추가만):
  - `@media (max-width: 767px)` : `.row-box` 세로 정렬, `.panel-body` 패딩 보정.
  - `@supports (height: 100dvh)` : `.hub`, `.panel_content` 의 100vh → dvh 보정(iOS).
- **이유**: 아이폰에서 카드 선택 화면이 잘리고 스탯/기술 박스가 눌리던 문제 해결 +
  공통 컴포넌트 첫 실사용/검증. 카드 3D 플립·burst 애니메이션은 미변경.

### 4단계 — World 페이지 데이터 분리 + 모바일 반응형
- `Data/world.js` 신규 : 헤더/바이라인/본문을 구조화 데이터로 분리.
  본문은 순서 있는 블록 배열(image/label/text/figure) — float 레이아웃이
  DOM 순서에 의존하므로 순서 보존이 중요.
- `Pages/World.js` : 하드코딩 JSX → 데이터 기반 렌더(`renderBlock`).
  클래스명/DOM 순서 동일, 모든 `<img>`에 `alt` 추가(기존 a11y 경고 해소),
  `images.world.*` 연결.
- `Styles/World.css` (추가만) : `@media (max-width: 767px)`에서 본문 이미지
  (`.article-image/.article-berry-image/.article-zetta-image`) float 해제 +
  width 100%(max 360px) 중앙 정렬로 세로 스택.
- **이유**: 콘텐츠/표현 분리(텍스트를 JSX 밖에서 편집 가능), 아이폰에서 float로
  텍스트가 눌리던 문제 해결. 데스크톱 잡지(float) 레이아웃은 그대로 유지.
- **방침**: float→flex 전면 교체는 데스크톱 텍스트 감싸기를 깨므로 하지 않고,
  모바일에서만 float을 해제하는 방식 선택.

### 5단계 — Home 페이지 모바일 마무리
- `Pages/Home.js` : 빈 `.message-box`(200vh) 마크업 제거(하단 불필요한 빈 스크롤
  공간 정리), 카드 이미지 → `images.home.card` 연결.
- `Styles/Home.css` : `.title h2`(캐릭터 이름)에 `clamp(1rem, 5vw, 2rem)` 적용 →
  좁은 화면에서 긴 영문 이름 오버플로 방지. 빈 `.message-box` CSS 제거.
- **이유**: 아이폰에서 이름 오버플로/하단 빈 공간 정리. 스크롤 축소/고정
  애니메이션(JS)과 `.bg-100w` 배경은 미변경.

### 6단계 — Safari 네비게이션 블렌드 수정
- `Styles/Components.css` : `.bar`에서 `mix-blend-mode` 제거(블러만 유지),
  반전 효과는 글자/아이콘에만 적용(`.bar a` 유지, `.bar span` 추가,
  `.nav-extra a`는 `all: unset` 때문에 명시적 추가).
- **이유**: `backdrop-filter`(blur)와 `mix-blend-mode`를 같은 요소에 두면
  Safari가 요소를 격리해 블렌드가 깨진다. 두 효과를 분리(블러=컨테이너,
  반전=텍스트)해 충돌 해소.
- **주의**: 제 환경에서 Safari 검증 불가. 실제 iOS/Safari에서 글자·햄버거 반전과
  블러가 함께 보이는지 확인 필요.

---

## 현재 적용 현황
- ✅ InfoItem : CharacterPanel 적용
- ✅ images.characters.* / images.world.* / images.home.card : 연결
- ✅ World 콘텐츠 : world.js 분리 완료
- ✅ Home / World / Character : 모바일 보정 1차 완료
- ⬜ ArticleContainer / ResponsiveImage : 생성만, 미적용
- ⬜ `.bg-100w` 배경 : App.css에서 직접 url(png) 사용 중(미연결)
- ⬜ breakpoints.js : JS에서 아직 미사용(CSS는 리터럴 px)

## 다음 작업 후보
1. CharacterPanel 남은 `alt` 누락 경고 정리 + ResponsiveImage 점진 도입.
2. 비표준 breakpoint(1500/1000/650/480) 정리 검토 — 회귀 위험 있어 신중히.
3. 미구현 페이지(Story/Gallery/Playlist) 착수.

## 검증 메모
- 각 단계 후 `cd client && CI=false npm run build` 로 컴파일 확인.
- CSS 시각/스크롤 동작은 브라우저(특히 iPhone 375/390px)에서 직접 확인 필요.
