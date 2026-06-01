/**
 * build-stories.mjs
 * Google 스프레드시트에서 내보낸 세션별 TSV(11개)를 client/src/Data/stories.js 로 변환한다.
 * 일회성 스크립트 — 데이터가 확정되면 이 scripts 폴더는 삭제해도 된다.
 *
 * 실행: client/ 에서  node scripts/build-stories.mjs
 *
 * TSV 컬럼: col1=시점(scene) 헤더, col4=화자(미겔/마티암), col5=대사.
 * 이미지가 있던 대사는 "화자+빈대사" 행 + 뒤따르는 "화자없음+텍스트" 행으로 쪼개져 있어
 * 둘을 합쳐 복원하고, 합쳐진 대사에는 image:null 슬롯을 남긴다(나중에 이미지 매핑).
 * 화자 없는 단독 텍스트(ㄴ 메모)는 제외한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'src', 'Data', 'stories.js');

// 파일명 → 세션 메타(순서/ id / 제목). 순서는 사용자가 확정한 스토리 진행 순.
const SESSIONS = [
  { file: 'MIHEARTI - 주점 이니트.tsv',                 id: 'init',           title: '주점 이니트' },
  { file: 'MIHEARTI - 도브 돌라.tsv',                   id: 'dov-dola',       title: '도브 돌라' },
  { file: 'MIHEARTI - 도브 돌라, 그 후.tsv',             id: 'dov-dola-after', title: '도브 돌라, 그 후' },
  { file: 'MIHEARTI - 마녀 헨젤의 성.tsv',               id: 'hansel-castle',  title: '마녀 헨젤의 성' },
  { file: 'MIHEARTI - 콘 오글로즈 늪지대.tsv',           id: 'con-oglos',      title: '콘 오글로즈 늪지대' },
  { file: 'MIHEARTI - 아그렘 판당고.tsv',                id: 'agrem-fandango', title: '아그렘 판당고' },
  { file: 'MIHEARTI - 아낙시소스 숲.tsv',                id: 'anacsisaus',     title: '아낙시소스 숲' },
  { file: 'MIHEARTI - 나스&지하 수로.tsv',               id: 'narrs-sewer',    title: '나스&지하 수로' },
  { file: 'MIHEARTI - 지하 수로&테이너시스 거점.tsv',     id: 'tainersis',      title: '지하 수로&테이너시스 거점' },
  { file: 'MIHEARTI - 마계.tsv',                        id: 'demon-realm',    title: '마계' },
  { file: 'MIHEARTI - 엔딩 D-1.tsv',                    id: 'ending',         title: '엔딩 D-1' },
];

const SPEAKER = { '미겔': 'migel', '마티암': 'matiam' };

const stats = { sessions: 0, scenes: 0, lines: 0, images: 0, memos: 0 };

function parseSession(meta, order) {
  const raw = fs.readFileSync(path.join(__dirname, meta.file), 'utf8');
  const rows = raw.split(/\r?\n/).map((l) => l.split('\t'));

  const scenes = [];
  let scene = null;
  let pending = null; // 이미지 대사: { speaker } 텍스트 대기 중

  const ensureScene = (label) => {
    scene = { label, lines: [] };
    scenes.push(scene);
  };
  const flushPending = () => {
    if (pending) {
      // 텍스트가 끝내 없던 이미지-only 대사(데이터상 없지만 방어적으로 보존)
      if (!scene) ensureScene('');
      scene.lines.push({ speaker: pending.speaker, text: '', image: null });
      stats.images++;
      pending = null;
    }
  };

  for (const cols of rows) {
    const sceneHeader = (cols[1] || '').trim();
    const spkRaw = (cols[4] || '').trim();
    const text = (cols[5] || '').trim();

    if (sceneHeader) {
      flushPending();
      ensureScene(sceneHeader);
      continue;
    }
    if (spkRaw) {
      flushPending();
      if (!scene) ensureScene(''); // 헤더 없는 세션(주점 이니트)
      const speaker = SPEAKER[spkRaw];
      if (!speaker) throw new Error(`알 수 없는 화자 "${spkRaw}" (${meta.file})`);
      if (text) {
        scene.lines.push({ speaker, text });
        stats.lines++;
      } else {
        pending = { speaker }; // 이미지 대사 — 텍스트는 다음 행에서
      }
      continue;
    }
    // 화자 없음
    if (text) {
      if (pending) {
        if (!scene) ensureScene('');
        scene.lines.push({ speaker: pending.speaker, text, image: null });
        stats.lines++;
        stats.images++;
        pending = null;
      } else {
        stats.memos++; // ㄴ 메모 → 제외
      }
    }
    // 빈 행은 무시 (pending 유지)
  }
  flushPending();

  const cleanScenes = scenes
    .filter((s) => s.lines.length > 0)
    .map((s, i) => ({ id: `${meta.id}-${i + 1}`, label: s.label, lines: s.lines }));

  stats.sessions++;
  stats.scenes += cleanScenes.length;
  return { id: meta.id, title: meta.title, order, scenes: cleanScenes };
}

const stories = SESSIONS.map((m, i) => parseSession(m, i + 1));

// TSV로는 이미지가 사라져 자동 감지 안 되지만 삽화를 넣기로 한 추가 위치.
// (해당 세션에서 nth 번째 화자 대사에 image 자리를 표시)
const EXTRA_IMAGE_LINES = [
  { session: 'dov-dola', speaker: 'migel', nth: 1 },   // "찢기고 태워진 전단지~"
  { session: 'anacsisaus', speaker: 'migel', nth: 1 }, // "죽은 듯 고요해진 숲에서 노래한다"
];
for (const ex of EXTRA_IMAGE_LINES) {
  const s = stories.find((x) => x.id === ex.session);
  if (!s) continue;
  let count = 0;
  let done = false;
  for (const sc of s.scenes) {
    for (const ln of sc.lines) {
      if (ln.speaker !== ex.speaker) continue;
      count += 1;
      if (count === ex.nth) {
        if (!('image' in ln)) { ln.image = null; stats.images += 1; }
        done = true;
        break;
      }
    }
    if (done) break;
  }
}

const header = `/**
 * stories.js — MIHEARTI 스토리(미겔·마티암 대화)
 * scripts/build-stories.mjs 로 TSV에서 자동 생성됨. 직접 수정보다 스크립트 재실행 권장.
 *
 * 구조: stories[] → { id, title, order, scenes[] }
 *        scene → { id, label(시점/날짜), lines[] }
 *        line  → { speaker: 'migel'|'matiam', text, image? }
 *
 * image 필드: 원래 이미지가 있던 대사에만 존재하며 현재 null(미매핑).
 *             나중에 이미지를 추가할 자리다. (총 ${stats.images}곳)
 */
`;

const body = `export const stories = ${JSON.stringify(stories, null, 2)};\n\nexport default stories;\n`;

fs.writeFileSync(OUT, header + body, 'utf8');

console.log('생성 완료 →', path.relative(path.join(__dirname, '..'), OUT));
console.log('세션:', stats.sessions, '| 시점:', stats.scenes, '| 대사:', stats.lines,
  '| 이미지 슬롯:', stats.images, '| 제외된 메모:', stats.memos);
