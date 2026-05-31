# ARCHITECTURE.md

## 전체 아키텍처

이 프로젝트는 React 클라이언트와 Express 서버로 구성된다.

초기 개발 단계에서는 프론트엔드 UI 완성을 우선하며, Character, World, Story 같은 정적인 콘텐츠는 클라이언트 내부 JS 데이터 파일로 관리한다.

Express 서버는 이후 필요한 최소 기능만 담당한다.

```txt
React Client
  ├─ Home
  ├─ World
  ├─ Character
  ├─ Story
  ├─ Gallery
  └─ Playlist

Express Server
  ├─ Image API
  ├─ Playlist API
  └─ YouTube API Proxy
```

## 설계 방향

이 프로젝트는 개인 창작 웹페이지이므로, 복잡한 엔터프라이즈 구조보다 단순하고 유지보수하기 쉬운 구조를 우선한다.

중요한 설계 원칙:

- 프론트엔드 UI를 먼저 완성한다.
- 정적인 창작 데이터는 클라이언트 로컬 JS 파일에서 관리한다.
- 백엔드는 꼭 필요한 기능에만 사용한다.
- 페이지별 데이터와 UI를 분리한다.
- 디자인 톤은 전체적으로 통일한다.
- 캐릭터 고유 색상은 데이터 기반으로 관리한다.

## 클라이언트 구조

권장 구조:

```txt
client/
  src/
    assets/
      images/
        characters/
        gallery/
        backgrounds/
        textures/
      icons/

    components/
      layout/
      common/
      character/
      world/
      story/
      gallery/
      playlist/

    data/
      characters.js
      world.js
      stories.js
      gallery.js
      playlist.js

    pages/
      Home.jsx
      World.jsx
      Character.jsx
      Story.jsx
      Gallery.jsx
      Playlist.jsx

    routes/
      AppRouter.jsx

    styles/
      global.css
      theme.css

    utils/
      format.js

    App.jsx
    main.jsx
```

## 페이지 구조

### Home

Home은 전체 웹페이지의 입구 역할을 한다.

주요 구성:

- 대표 타이틀
- 미하티 소개 문구
- 분위기 이미지 또는 배경
- 주요 페이지 이동 카드
- 짧은 인용구 또는 상징 문장

---

### World

World는 세계관 데이터를 기반으로 렌더링한다.

데이터 예시:

```js
export const worldSections = [
  {
    id: "kingdom",
    title: "왕국",
    summary: "세계관의 주요 왕국 설명",
    content: "상세 설명"
  }
];
```

---

### Character

Character는 캐릭터 데이터 기반으로 렌더링한다.

데이터 예시:

```js
export const characters = [
  {
    id: "character-a",
    name: "캐릭터 이름",
    title: "칭호 또는 역할",
    color: "#8B5E3C",
    quote: "대표 문구",
    description: "캐릭터 설명",
    traits: ["차분함", "책임감"],
    image: characterImage
  }
];
```

---

### Story

Story는 이야기 목록과 상세 내용을 관리한다.

데이터 예시:

```js
export const stories = [
  {
    id: "first-meeting",
    title: "첫 만남",
    order: 1,
    summary: "짧은 요약",
    content: "본문",
    relatedCharacters: ["character-a", "character-b"],
    tags: ["시작", "관계"]
  }
];
```

---

### Gallery

Gallery는 이미지 오브젝트와 메타데이터를 기반으로 구성한다.

데이터 예시:

```js
export const galleryItems = [
  {
    id: "gallery-001",
    title: "이미지 제목",
    description: "이미지 설명",
    image: galleryImage001,
    characters: ["character-a"],
    tags: ["portrait", "calm"]
  }
];
```

초기에는 프론트엔드 assets에서 이미지를 import하여 사용한다.

추후 이미지 수가 많아지면 Express 서버에서 이미지 메타데이터를 제공할 수 있다.

---

### Playlist

Playlist는 초기에는 로컬 데이터로 UI를 구성하고, 이후 Express 서버와 YouTube API를 연결한다.

데이터 예시:

```js
export const playlistItems = [
  {
    id: "song-001",
    title: "노래 제목",
    artist: "가수",
    youtubeVideoId: "YouTube Video ID",
    description: "이 곡이 미하티와 어울리는 이유",
    relatedCharacters: ["character-a", "character-b"],
    tags: ["calm", "memory"]
  }
];
```

## 서버 구조

권장 구조:

```txt
server/
  src/
    routes/
      playlistRoutes.js
      imageRoutes.js
      youtubeRoutes.js

    controllers/
      playlistController.js
      imageController.js
      youtubeController.js

    services/
      playlistService.js
      youtubeService.js

    data/
      playlists.json

    app.js
    server.js
```

## 서버 역할

Express 서버는 다음 역할을 담당한다.

### 1. Playlist API

- 플레이리스트 목록 조회
- 플레이리스트 항목 추가
- 플레이리스트 항목 삭제
- 플레이리스트 순서 관리

예상 API:

```txt
GET    /api/playlists
POST   /api/playlists
PATCH  /api/playlists/:id
DELETE /api/playlists/:id
```

초기에는 DB 대신 JSON 파일 저장 또는 간단한 메모리 저장 방식으로 시작할 수 있다.

---

### 2. YouTube API Proxy

YouTube API Key를 프론트엔드에 노출하지 않기 위해 Express 서버에서 YouTube API 요청을 중계한다.

예상 API:

```txt
GET /api/youtube/search?q=
GET /api/youtube/video/:videoId
```

주의 사항:

- API Key는 서버의 `.env`에 저장한다.
- 프론트엔드에 API Key를 직접 작성하지 않는다.
- 요청 실패 시 에러 메시지를 명확히 반환한다.

---

### 3. Image API

초기에는 프론트엔드 assets 기반 이미지 관리로 충분하다.

추후 필요 시 다음 기능을 추가할 수 있다.

```txt
GET /api/images
GET /api/images/:id
```

이미지 업로드 기능은 초기 범위에 포함하지 않는다.

## 데이터 흐름

### 정적 콘텐츠 흐름

Character, World, Story 데이터는 다음 흐름을 가진다.

```txt
JS data file
  → Page component
  → Common UI component
  → Render
```

예시:

```txt
characters.js
  → Character.jsx
  → CharacterCard.jsx
  → 화면 출력
```

### Playlist 흐름

초기:

```txt
playlist.js
  → Playlist.jsx
  → PlaylistCard.jsx
  → 화면 출력
```

API 연결 후:

```txt
Express Playlist API
  → Playlist.jsx
  → PlaylistCard.jsx
  → MusicPlayer.jsx
  → 화면 출력
```

### YouTube API 흐름

```txt
Client
  → Express /api/youtube/search
  → YouTube API
  → Express
  → Client
```

## 상태 관리

초기에는 전역 상태 관리 라이브러리를 사용하지 않는다.

권장 방식:

- 페이지 내부 state
- props 전달
- 간단한 custom hook

추후 필요할 때만 상태 관리 라이브러리를 검토한다.

## 스타일 구조

스타일은 다음 기준으로 관리한다.

```txt
styles/
  global.css
  theme.css
```

`theme.css`에는 프로젝트 전체 분위기와 관련된 값을 관리한다.

예상 항목:

- 배경색
- 양피지 색상
- 텍스트 색상
- 테두리 색상
- 캐릭터별 기본 색상
- 그림자
- 폰트 계열

## 리팩터링 대상

현재 구현된 Home, World, Character에서 우선적으로 확인할 부분:

1. 하드코딩된 데이터가 많은지
2. 반복되는 카드 UI가 있는지
3. 페이지마다 레이아웃 방식이 다른지
4. 캐릭터 색상 적용 방식이 일관적인지
5. 이미지 경로 관리가 흩어져 있는지
6. CSS 클래스명이 너무 복잡하거나 중복되는지
7. 컴포넌트가 지나치게 긴지

## 확장 가능성

추후 확장할 수 있는 기능:

- Story 상세 페이지
- Character 상세 페이지
- Gallery 필터
- 이미지 모달
- Playlist 검색
- YouTube 영상 미리듣기
- 관리자 페이지
- 방명록
- 다크/라이트 테마

단, 초기에는 핵심 감성과 UI 완성도를 우선한다.
