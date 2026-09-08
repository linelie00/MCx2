/**
 * loadCommands — src/commands/*.js 를 모아 이름 → 핸들러 맵으로 만든다.
 *
 * 각 파일은 명령 하나(객체) 또는 여러 개(배열)를 default 로 내보낸다.
 * 파일명은 영어로 쓴다 — 한글 파일명은 Windows 와 Linux 사이에서 유니코드 정규화(NFC/NFD)가
 * 어긋나 import 가 깨질 수 있다. 슬래시 명령 이름만 한국어다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'commands');

export async function loadCommands() {
  const commands = new Map();

  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(pathToFileURL(path.join(DIR, file)).href);
    for (const cmd of [mod.default].flat()) {
      if (!cmd?.data || typeof cmd.execute !== 'function') {
        console.warn(`[commands] ${file} 의 내보내기가 명령 형태가 아닙니다. 건너뜁니다.`);
        continue;
      }
      commands.set(cmd.data.name, cmd);
    }
  }

  return commands;
}

export default loadCommands;
