/**
 * content — bot/data/*.json 로더
 *
 * 부팅 시 한 번만 읽는다. 파일이 크지 않고(대사 404KB) 런타임에 바뀌지 않으므로
 * 매번 읽을 이유가 없다. 원본을 고쳤으면 scripts/build-content.mjs 를 다시 돌린다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const read = (name) => {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) {
    console.error(`[content] ${name} 이 없습니다. 레포 루트에서 다음을 실행하세요:`);
    console.error('          node bot/scripts/build-content.mjs');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

export const lines = read('lines.json').lines;
export const characters = read('characters.json').characters;
export const world = read('world.json');
export const accents = read('accents.json').accents;
export const quotes = read('quotes.json').quotes;

/** 화자별 대사. 캐입 few-shot 과 /대사 랜덤에서 쓴다. */
export const linesBySpeaker = {
  migel: lines.filter((l) => l.speaker === 'migel'),
  matiam: lines.filter((l) => l.speaker === 'matiam'),
};

console.log(
  `[content] 대사 ${lines.length}줄 · 명대사 ${quotes.length}개 · 캐릭터 ${Object.keys(characters).length}명`,
);

export default { lines, characters, world, quotes, linesBySpeaker };
