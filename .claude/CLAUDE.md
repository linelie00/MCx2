# CLAUDE.md

## 프로젝트 개요

이 프로젝트는 자캐커플 "미하티"를 소개하고 기록하기 위한 개인 웹페이지이다.

주요 페이지는 다음과 같다.

- Home
- World
- Character
- Story
- Gallery
- Playlist

전체 분위기는 현재 디자인을 최대한 유지하되, 양피지 느낌과 캐릭터 고유 색을 활용하여 차분한 중세풍, 낡은 책, 기록 보관소 같은 인상을 주는 것을 목표로 한다.

## 현재 개발 상태

현재 구현된 범위는 다음과 같다.

- Home
- World
- Character

위 페이지들은 이미 개발되어 있으나, 구조 개선, UI 정리, 컴포넌트 분리, 데이터 구조 개선 등은 진행해도 된다.

아직 개발이 필요한 페이지는 다음과 같다.

- Story
- Gallery
- Playlist

## 기술 스택

### Frontend

- React
- JavaScript
- 로컬 JS 데이터 파일 기반 콘텐츠 관리
- 이미지 파일은 프론트엔드 이미지 오브젝트 또는 assets 폴더를 통해 관리

### Backend

- Express
- JavaScript
- 최소한의 API 서버 역할만 수행

백엔드는 초기 단계에서 핵심 로직을 많이 가지지 않고, 다음 기능을 중심으로 사용한다.

- 이미지 관리
- Playlist 페이지에서 YouTube API 연동
- 플레이리스트 정보 저장
- 필요한 경우 프론트엔드에 API 형태로 데이터 제공

## 작업 우선순위

작업은 다음 순서로 진행한다.

1. 기존 코드 분석
2. 기존 코드 리팩터링
3. 현재 구현된 Home / World / Character 개선
4. 프론트엔드 UI 완성
5. Story 페이지 개발
6. Gallery 페이지 개발
7. Playlist 페이지 개발
8. Express API 연결
9. YouTube API 및 플레이리스트 저장 기능 연결

## 중요한 작업 원칙

- 바로 코드를 수정하지 말고, 먼저 현재 구조를 분석한다.
- 큰 변경 전에는 반드시 수정 계획을 먼저 제안한다.
- 기존 디자인의 핵심 분위기를 무너뜨리지 않는다.
- 현재 구현된 기능의 동작을 임의로 변경하지 않는다.
- 한 번에 너무 많은 파일을 수정하지 않는다.
- 리팩터링과 기능 추가를 한 작업 안에서 섞지 않는다.
- 프론트엔드 UI를 먼저 안정화한 뒤 API 연결을 진행한다.
- 새 라이브러리 추가 전에는 이유와 대안을 먼저 설명한다.
- 불필요하게 복잡한 구조를 만들지 않는다.
- 개인 프로젝트이므로 유지보수하기 쉬운 단순한 구조를 우선한다.

## 데이터 관리 원칙

캐릭터, 세계관, 스토리 데이터는 자주 추가되거나 변경되지 않는다.

따라서 DB에 저장하지 않고 프론트엔드 내부의 JS 데이터 파일로 관리한다.

예상 구조:

```txt
client/src/data/
  characters.js
  world.js
  stories.js
  gallery.js
  playlist.js
```

데이터 파일은 다음 원칙을 따른다.

- 화면에 직접 하드코딩하지 않는다.
- 반복되는 콘텐츠는 data 파일로 분리한다.
- 이미지 경로 또는 import는 일관된 방식으로 관리한다.
- 캐릭터 고유 색상, 상징, 문구 등은 character 데이터에 포함한다.
- Story, World, Character는 서로 연결될 수 있도록 id 기반으로 관리한다.

## UI 방향

전체 UI는 다음 분위기를 따른다.

- 양피지
- 낡은 책
- 기록 보관소
- 중세풍
- 차분함
- 캐릭터별 고유 색상
- 과하지 않은 장식
- 읽기 편한 레이아웃

피해야 할 방향:

- 지나치게 현대적인 SaaS 대시보드 느낌
- 너무 밝고 가벼운 카드 UI
- 과한 애니메이션
- 복잡한 3D 효과
- 원색 위주의 강한 대비
- 캐릭터 고유 색이 전체 분위기를 해칠 정도로 과하게 사용되는 것

## 컴포넌트 설계 원칙

가능하면 다음 컴포넌트를 분리한다.

```txt
components/
  layout/
    Header.jsx
    Footer.jsx
    PageLayout.jsx
    Navigation.jsx

  common/
    SectionTitle.jsx
    ParchmentCard.jsx
    MedievalFrame.jsx
    CharacterBadge.jsx
    QuoteBox.jsx

  character/
    CharacterCard.jsx
    CharacterProfile.jsx
    CharacterDetail.jsx

  world/
    WorldSection.jsx
    TimelineItem.jsx

  story/
    StoryCard.jsx
    StoryViewer.jsx

  gallery/
    GalleryGrid.jsx
    GalleryModal.jsx

  playlist/
    PlaylistCard.jsx
    MusicPlayer.jsx
```

컴포넌트는 다음 기준을 따른다.

- 재사용 가능한 UI는 common으로 분리한다.
- 페이지 컴포넌트 안에 너무 많은 JSX를 직접 작성하지 않는다.
- 데이터 렌더링과 UI 표현을 분리한다.
- 캐릭터 색상은 props 또는 data에서 받아 사용한다.
- 페이지별 분위기는 유지하되 전체 톤은 통일한다.

## 폴더 구조 권장안

```txt
project-root/
  client/
    src/
      assets/
        images/
        icons/
        textures/

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

  server/
    src/
      routes/
      controllers/
      services/
      data/
      app.js
      server.js

  docs/
    PROJECT_OVERVIEW.md
    ARCHITECTURE.md
    FEATURE_ROADMAP.md
    UI_GUIDE.md
```

## 리팩터링 규칙

리팩터링 시 다음을 우선한다.

1. 중복 JSX 제거
2. 반복되는 카드 UI 컴포넌트화
3. 하드코딩된 텍스트를 data 파일로 이동
4. 페이지별 레이아웃 통일
5. CSS 클래스명 정리
6. 캐릭터 고유 색상 관리 방식 통일
7. 이미지 경로 관리 방식 통일
8. 사용하지 않는 코드 제거

리팩터링 시 금지 사항:

- 기존 페이지를 완전히 새로 작성하지 않는다.
- 디자인 방향을 임의로 크게 바꾸지 않는다.
- 기능 추가와 리팩터링을 동시에 하지 않는다.
- 기존 데이터를 삭제하지 않는다.
- 동작 확인 없이 구조만 크게 바꾸지 않는다.

## 작업 요청을 받았을 때 응답 방식

작업 전에는 다음을 먼저 정리한다.

1. 현재 구조 요약
2. 수정 대상 파일
3. 수정 이유
4. 예상 변경 범위
5. 위험 요소
6. 작업 순서

작업 후에는 다음 형식으로 요약한다.

1. 변경한 파일
2. 변경 내용
3. 리팩터링한 이유
4. 유지한 기존 동작
5. 확인이 필요한 부분
6. 다음 추천 작업

## 개발 명령어

프로젝트의 실제 명령어가 확인되면 아래를 수정한다.

### Client

```bash
cd client
npm install
npm run dev
npm run build
```

### Server

```bash
cd server
npm install
npm run dev
```

## API 연결 원칙

초기에는 프론트엔드 로컬 데이터 기반으로 UI를 완성한다.

API 연결은 다음 단계에서 진행한다.

1. UI 완성
2. 데이터 구조 안정화
3. Express 서버 기본 구조 작성
4. Playlist API 연결
5. YouTube API 연동
6. 이미지 관리 API 연결
7. 필요한 경우 저장 기능 추가

## 백엔드 작업 원칙

백엔드는 최소한의 기능만 담당한다.

초기 백엔드 역할:

- Playlist 정보 저장
- YouTube API 요청 중계
- 이미지 메타데이터 관리
- 필요한 경우 정적 이미지 제공

백엔드가 담당하지 않아도 되는 것:

- Character 데이터 저장
- Story 데이터 저장
- World 데이터 저장
- 복잡한 관리자 기능
- 과도한 인증 시스템

## 보안 및 환경변수

YouTube API Key 같은 민감한 값은 코드에 직접 작성하지 않는다.

환경변수 예시:

```txt
YOUTUBE_API_KEY=
PORT=
```

`.env` 파일은 Git에 올리지 않는다.

## 최종 목표

이 프로젝트의 최종 목표는 단순한 정보 페이지가 아니라, 미하티라는 자캐커플의 세계관, 관계성, 이미지, 음악, 이야기를 하나의 기록 보관소처럼 감상할 수 있는 웹페이지를 만드는 것이다.

기술적으로는 과하게 복잡하지 않게, 감성적으로는 몰입감 있게 만드는 것을 우선한다.
