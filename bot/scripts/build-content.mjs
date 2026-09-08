/**
 * build-content.mjs
 * client/src/Data 의 정적 콘텐츠를 봇이 읽을 평문 JSON 으로 뽑아 bot/data/ 에 넣는다.
 *
 * 왜 필요한가:
 *   Railway 는 Root Directory 를 bot 으로 두면 그 폴더만 내려받는다. 런타임에 ../client 는
 *   존재하지 않는다. 그래서 산출물을 bot/data/ 에 커밋해 두고 봇은 그것만 읽는다.
 *   게다가 Characters.js / world.js 는 .webp 를 import 해서 Node 에서 그대로 못 읽고,
 *   stories.js 는 CRA package.json 에 type:module 이 없어 .js 를 ESM 으로 import 할 수 없다.
 *
 * 실행 (레포 루트에서):
 *   node bot/scripts/build-content.mjs
 *
 * 원본을 고쳤으면 다시 돌리고 산출물을 커밋한다.
 * client/scripts/build-stories.mjs 와 같은 성격의 스크립트다.
 *
 * quotes.json 은 건드리지 않는다 — 사람이 편집하는 파일이라 검증만 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT = path.join(HERE, '..');
const DATA_SRC = path.join(BOT, '..', 'client', 'src', 'Data');
const OUT = path.join(BOT, 'data');

const HEADER = '이 파일은 scripts/build-content.mjs 가 생성합니다. 직접 고치지 마세요.';

/**
 * 이미지 import 를 스텁으로 대체하고 모듈을 평가해 값을 꺼낸다.
 *
 * 왜 정규식으로 필드를 긁지 않는가:
 *   personality / etc 가 여러 줄 백틱 프로즈라 정규식으로는 금방 깨진다.
 *   vm 은 스무 줄이면 되고, 본문 텍스트를 아무리 고쳐도 안 깨진다.
 */
function evalModule(file, exportName, extraContext = {}) {
  const src = fs.readFileSync(file, 'utf8')
    .replace(/^\s*import\s.*$/gm, '')
    .replace(/^\s*export\s+default\s.*$/gm, '')
    // 파일에 named export 가 여럿 있을 수 있다(colors.js 는 4개). 전부 평범한 선언으로 바꾼다.
    // var 로 바꾸면 vm 컨텍스트의 전역이 되어 아래에서 ctx[exportName] 로 꺼낼 수 있다.
    .replace(/^\s*export\s+(?:const|let|var)\s+/gm, 'var ');

  // images.characters.migel.portrait 처럼 어떤 깊이로 접근해도 문자열이 나오는 스텁.
  // 이미지 경로는 봇이 쓰지 않으므로 값이 무엇이든 상관없다.
  const imgStub = new Proxy(() => '', { get: () => imgStub });

  const ctx = { images: imgStub, [exportName]: null, ...extraContext };
  vm.runInNewContext(`${src}\n;`, ctx, { filename: file });

  if (!ctx[exportName]) throw new Error(`${path.basename(file)} 에서 ${exportName} 를 얻지 못했습니다.`);
  return ctx[exportName];
}

/** stories.js — import 는 없지만 ESM 이라 import 할 수 없다. 리터럴만 잘라 JSON.parse 한다. */
function readStories() {
  const src = fs.readFileSync(path.join(DATA_SRC, 'stories.js'), 'utf8');
  const at = src.indexOf('export const stories =');
  if (at < 0) throw new Error('stories.js 에서 export 를 찾지 못했습니다.');
  // build-stories.mjs 가 JSON.stringify 결과를 그대로 박아 넣으므로 이 구간은 유효한 JSON 이다.
  return JSON.parse(src.slice(src.indexOf('[', at), src.lastIndexOf(']') + 1));
}

const write = (name, payload) => {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, `${JSON.stringify({ _: HEADER, ...payload }, null, 2)}\n`, 'utf8');
  console.log(`  ${name.padEnd(18)} ${Math.round(fs.statSync(file).size / 1024)}KB`);
};

// ---------------------------------------------------------------- 실행

fs.mkdirSync(OUT, { recursive: true });
console.log('생성:');

// ===== lines.json — 대사 467줄을 평탄화 =====
const stories = readStories();
const lines = [];
for (const session of stories) {
  for (const scene of session.scenes) {
    scene.lines.forEach((l, i) => {
      lines.push({
        id: `${scene.id}#${i}`,
        speaker: l.speaker,
        text: l.text.replace(/\s+/g, ' ').trim(),
        session: session.title,
        sessionId: session.id,
        scene: scene.label || null,
      });
    });
  }
}
write('lines.json', { lines });

// ===== characters.json — 이미지 경로는 버리고 텍스트만 =====
const characterColors = evalModule(
  path.join(DATA_SRC, 'constants', 'colors.js'),
  'characterColors',
);
const characters = evalModule(
  path.join(DATA_SRC, 'Characters.js'),
  'characters',
  { characterColors },
);

const pickCharacter = (c) => ({
  name: c.name,
  realname: c.realname,
  color: c.color,
  title: c.title,
  appearance: { description: c.appearance?.description ?? '' },
  description: c.description,      // job/body/gender/race/age/personality/etc/belongings
  quotes: c.quotes ?? [],
  stats: c.stats ?? [],
  skill: c.skill ?? [],
  attack_types: c.attack_types ?? '',
});
write('characters.json', {
  characters: Object.fromEntries(
    Object.entries(characters).map(([k, v]) => [k, pickCharacter(v)]),
  ),
});

// ===== accents.json — 재생목록 강조색 =====
// 봇의 /플리 만들기 에서 선택지로 쓴다. 여기서 뽑아 두지 않으면 사이트가 색을
// 추가했을 때 봇만 옛 목록을 들고 있게 된다.
const playlistAccents = evalModule(
  path.join(DATA_SRC, 'constants', 'colors.js'),
  'playlistAccents',
);
write('accents.json', { accents: playlistAccents.map(({ id, label }) => ({ id, label })) });

// ===== world.json — 로어 텍스트만 (이미지 블록 제외) =====
const world = evalModule(path.join(DATA_SRC, 'world.js'), 'world');
const worldBlocks = (world.body ?? [])
  .filter((b) => b.type === 'label' || b.type === 'text')
  .map((b) => (b.type === 'label'
    ? { type: 'label', text: b.text }
    : { type: 'text', text: b.lines.join('\n') }));
write('world.json', {
  headline: world.header?.headline ?? '',
  details: world.header?.details ?? '',
  blocks: worldBlocks,
});

// ===== quotes.json 검증 — 생성하지 않고 어긋난 것만 알린다 =====
const quotesFile = path.join(OUT, 'quotes.json');
if (fs.existsSync(quotesFile)) {
  const { quotes } = JSON.parse(fs.readFileSync(quotesFile, 'utf8'));

  // quotes 는 지문을 남긴 것과 뺀 것이 섞여 있으므로 두 형태 모두를 대조 대상으로 삼는다.
  const bare = (t) => t.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const haystack = lines.map((l) => `${l.text}\n${bare(l.text)}`).join('\n');

  // 원문에 남아 있는지 본다. 잘라 쓴 조각이 많으므로 앞 12자만 확인한다.
  const stale = [];
  for (const q of quotes) {
    const texts = q.type === 'pair' ? q.lines.map((l) => l.text) : [q.text];
    for (const t of texts) {
      const probe = t.replace(/^[.\s'"…]+/, '').slice(0, 12);
      if (probe && !haystack.includes(probe)) stale.push(`${q.id}: ${t.slice(0, 40)}`);
    }
  }

  const n = quotes.filter((q) => q.type === 'line').length;
  console.log(`\n검증: quotes.json — line ${n} / pair ${quotes.length - n}`);
  if (stale.length) {
    console.warn(`  ⚠ stories.js 에서 찾지 못한 대사 ${stale.length}건 (원본이 바뀌었을 수 있습니다):`);
    stale.forEach((s) => console.warn(`    ${s}`));
  } else {
    console.log('  모든 대사가 stories.js 에 존재합니다.');
  }
}

console.log(`\n대사 ${lines.length}줄 · 캐릭터 ${Object.keys(characters).length}명 · 로어 ${worldBlocks.length}블록`);
