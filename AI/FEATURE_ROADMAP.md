# FEATURE_ROADMAP.md

## 개발 방향

이 프로젝트는 기능을 빠르게 많이 추가하기보다, 기존 디자인과 감성을 유지하면서 안정적으로 확장하는 것을 목표로 한다.

개발 순서는 다음 원칙을 따른다.

1. 기존 코드 리팩터링
2. 현재 개발된 범위 개선
3. 프론트엔드 UI 완성
4. 새 페이지 개발
5. 최소 백엔드 연결
6. Playlist 및 YouTube API 연동

## Phase 1. 기존 코드 분석 및 리팩터링

목표:

- 현재 Home, World, Character 구조를 파악한다.
- 중복 코드와 하드코딩을 줄인다.
- 데이터와 UI를 분리한다.
- 전체 UI 톤을 정리한다.

작업 항목:

- [ ] 전체 폴더 구조 분석
- [ ] Home 페이지 구조 분석
- [ ] World 페이지 구조 분석
- [ ] Character 페이지 구조 분석
- [ ] 반복되는 UI 컴포넌트 확인
- [ ] 하드코딩된 캐릭터/세계관 데이터 확인
- [ ] data 폴더 정리
- [ ] 공통 컴포넌트 분리
- [ ] 사용하지 않는 코드 제거

우선 분리할 컴포넌트:

- [ ] PageLayout
- [ ] SectionTitle
- [ ] ParchmentCard
- [ ] CharacterCard
- [ ] QuoteBox
- [ ] Navigation

완료 기준:

- 기존 Home / World / Character가 정상적으로 동작한다.
- 데이터가 JS 파일로 분리되어 있다.
- 반복 UI가 컴포넌트화되어 있다.
- 전체 디자인 톤이 이전보다 일관적이다.

---

## Phase 2. 현재 구현된 페이지 개선

대상:

- Home
- World
- Character

### Home 개선

작업 항목:

- [ ] 첫 화면 분위기 강화
- [ ] 미하티 소개 문구 정리
- [ ] 각 페이지 이동 카드 추가 또는 개선
- [ ] 양피지/기록 보관소 느낌 반영
- [ ] 대표 문구 또는 인용구 배치
- [ ] 모바일 반응형 확인

완료 기준:

- 사용자가 첫 화면에서 프로젝트 분위기를 이해할 수 있다.
- 주요 페이지로 이동하기 쉽다.
- 낡은 책/기록 보관소 느낌이 난다.

---

### World 개선

작업 항목:

- [ ] 세계관 데이터를 world.js로 분리
- [ ] 세계관 섹션 컴포넌트화
- [ ] 긴 설명을 읽기 좋게 분리
- [ ] 필요 시 연표 또는 기록 카드 추가
- [ ] 배경 설정을 문서처럼 보여주는 UI 적용

완료 기준:

- 세계관 정보가 구조적으로 정리되어 있다.
- 단순 텍스트 나열이 아니라 기록 문서처럼 보인다.

---

### Character 개선

작업 항목:

- [ ] 캐릭터 데이터를 characters.js로 분리
- [ ] 캐릭터 카드 컴포넌트화
- [ ] 캐릭터 고유 색상 적용 방식 통일
- [ ] 캐릭터 대표 문구 추가
- [ ] 관계성 설명 영역 추가
- [ ] 캐릭터 이미지 영역 정리

완료 기준:

- 캐릭터 정보가 데이터 기반으로 렌더링된다.
- 캐릭터별 개성이 드러난다.
- 전체 중세풍 UI와 캐릭터 고유 색상이 조화된다.

---

## Phase 3. 전체 UI 시스템 정리

목표:

- 모든 페이지에서 동일한 시각 언어를 사용한다.
- 양피지, 낡은 책, 기록 보관소 느낌을 통일한다.

작업 항목:

- [ ] 전체 배경 톤 정리
- [ ] 공통 카드 스타일 정리
- [ ] 버튼 스타일 정리
- [ ] 제목 스타일 정리
- [ ] 텍스트 스타일 정리
- [ ] 캐릭터 색상 변수 정리
- [ ] 이미지 프레임 스타일 정리
- [ ] 페이지 전환 구조 정리
- [ ] 반응형 기준 정리

완료 기준:

- Home / World / Character / Story / Gallery / Playlist가 같은 세계 안에 있는 것처럼 보인다.
- 페이지별 개성은 있으나 전체 분위기는 통일되어 있다.

---

## Phase 4. Story 페이지 개발

목표:

- 미하티의 이야기를 장 또는 기록 형태로 감상할 수 있게 한다.

작업 항목:

- [ ] stories.js 데이터 구조 설계
- [ ] Story 목록 UI 개발
- [ ] Story 카드 컴포넌트 개발
- [ ] Story 상세 보기 방식 결정
- [ ] 캐릭터 연결 정보 추가
- [ ] 태그 또는 시간순 정렬 기능 검토

예상 데이터:

```js
{
  id: "first-meeting",
  title: "첫 만남",
  order: 1,
  summary: "짧은 요약",
  content: "본문",
  relatedCharacters: ["character-a", "character-b"],
  tags: ["시작", "관계"]
}
```

완료 기준:

- 이야기 목록을 볼 수 있다.
- 각 이야기를 읽기 편한 형태로 볼 수 있다.
- 캐릭터 또는 세계관과 연결되는 느낌이 있다.

---

## Phase 5. Gallery 페이지 개발

목표:

- 미하티 관련 이미지를 분위기 있게 감상할 수 있는 갤러리를 만든다.

작업 항목:

- [ ] gallery.js 데이터 구조 설계
- [ ] 이미지 import 방식 정리
- [ ] GalleryGrid 컴포넌트 개발
- [ ] GalleryItem 컴포넌트 개발
- [ ] 이미지 클릭 시 모달 개발
- [ ] 이미지 설명 영역 추가
- [ ] 태그 또는 캐릭터 필터 검토

예상 데이터:

```js
{
  id: "gallery-001",
  title: "이미지 제목",
  description: "이미지 설명",
  image: galleryImage001,
  characters: ["character-a"],
  tags: ["portrait", "calm"]
}
```

완료 기준:

- 이미지 목록이 그리드 형태로 표시된다.
- 이미지를 클릭하면 크게 볼 수 있다.
- 이미지별 설명과 태그를 볼 수 있다.
- 전체 UI와 어울리는 액자/기록 카드 느낌이 난다.

---

## Phase 6. Playlist 페이지 개발

목표:

- 미하티와 어울리는 음악을 모아 감상할 수 있는 페이지를 만든다.

초기 목표:

- 로컬 playlist.js 기반 UI 구현

후속 목표:

- Express API 연결
- YouTube API 연동
- 플레이리스트 유지 기능 추가

작업 항목:

- [ ] playlist.js 데이터 구조 설계
- [ ] Playlist 목록 UI 개발
- [ ] PlaylistCard 컴포넌트 개발
- [ ] 곡 설명 표시
- [ ] 캐릭터/스토리 연결 정보 표시
- [ ] YouTube videoId 기반 임베드 또는 재생 UI 검토
- [ ] Express API 연결
- [ ] YouTube API 검색 또는 영상 정보 조회 연결
- [ ] 플레이리스트 저장 기능 추가

예상 데이터:

```js
{
  id: "song-001",
  title: "노래 제목",
  artist: "가수",
  youtubeVideoId: "video-id",
  description: "이 곡이 어울리는 이유",
  relatedCharacters: ["character-a"],
  tags: ["calm", "memory"]
}
```

완료 기준:

- 곡 목록을 볼 수 있다.
- 곡 설명을 볼 수 있다.
- YouTube 영상과 연결할 수 있다.
- 백엔드를 통해 플레이리스트를 유지할 수 있다.

---

## Phase 7. Express 백엔드 기본 구축

목표:

- 프론트엔드와 연결할 최소한의 API 서버를 만든다.

작업 항목:

- [ ] Express 서버 기본 구조 생성
- [ ] CORS 설정
- [ ] 환경변수 설정
- [ ] 기본 health check API 작성
- [ ] Playlist API 작성
- [ ] YouTube API Proxy 작성
- [ ] 이미지 메타데이터 API 검토

예상 API:

```txt
GET /api/health

GET /api/playlists
POST /api/playlists
PATCH /api/playlists/:id
DELETE /api/playlists/:id

GET /api/youtube/search?q=
GET /api/youtube/video/:videoId
```

완료 기준:

- 클라이언트에서 서버 API를 호출할 수 있다.
- YouTube API Key가 클라이언트에 노출되지 않는다.
- Playlist 정보를 저장하고 불러올 수 있다.

---

## Phase 8. 정리 및 배포 준비

작업 항목:

- [ ] 불필요한 코드 제거
- [ ] console.log 제거
- [ ] README 정리
- [ ] 실행 방법 문서화
- [ ] 환경변수 예시 작성
- [ ] 빌드 확인
- [ ] 반응형 확인
- [ ] 배포 방식 결정
- [ ] 최종 UI 점검

완료 기준:

- 새로 프로젝트를 실행하는 사람이 README만 보고 실행할 수 있다.
- 주요 페이지가 모두 정상적으로 동작한다.
- 전체 분위기가 일관적이다.
- 최소 API 기능이 정상적으로 동작한다.

## 최종 MVP 기준

MVP 완료 기준은 다음과 같다.

- [ ] Home 페이지 완성
- [ ] World 페이지 완성
- [ ] Character 페이지 완성
- [ ] Story 페이지 완성
- [ ] Gallery 페이지 완성
- [ ] Playlist 페이지 기본 UI 완성
- [ ] 전체 UI 톤 통일
- [ ] 로컬 JS 데이터 기반 렌더링 완료
- [ ] Express 서버 기본 구조 완료
- [ ] Playlist API 기본 기능 완료
- [ ] YouTube API 연동 준비 완료
