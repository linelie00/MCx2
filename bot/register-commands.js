/**
 * 슬래시 명령 등록 — 손으로 돌리는 스크립트
 *
 *   cd bot && npm run register
 *
 * 길드 스코프로만 등록한다. 전역 등록은 반영에 최대 1시간이 걸리지만 길드는 즉시다.
 * 둘만 쓰는 서버라 전역으로 둘 이유가 없다.
 *
 * 명령의 이름·옵션을 바꿨을 때만 다시 실행하면 된다. 명령 내용(코드)만 고친 배포에는 불필요.
 */
import { REST, Routes } from 'discord.js';
import config from './src/config.js';
import { loadCommands } from './src/loadCommands.js';

const commands = await loadCommands();
const body = [...commands.values()].map((c) => c.data.toJSON());

const rest = new REST().setToken(config.discord.token);

const data = await rest.put(
  Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
  { body },
);

console.log(`[등록] ${data.length}개 완료: ${data.map((c) => `/${c.name}`).join(' ')}`);
