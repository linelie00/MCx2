/**
 * MIHEARTI 디스코드 봇 — 진입점
 *
 * 인텐트는 Guilds 하나면 된다. 모든 기능이 슬래시 명령이라 MessageContent 같은
 * 특권 인텐트가 필요 없다(디스코드 승인 절차를 안 밟아도 된다).
 */
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import config from './src/config.js';
import { loadCommands } from './src/loadCommands.js';
import { fail } from './src/embeds.js';
import { checkOwnerKeys } from './src/api.js';
import { useCustomFaces } from './src/yacht/render.js';
import {
  useCardEmoji, emojiName, BACK_NAME, SUITS, RANKS,
} from './src/casino/cards.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commands = await loadCommands();
console.log(`[봇] 명령 ${commands.size}개 적재: ${[...commands.keys()].join(', ')}`);

/**
 * 버튼·셀렉트를 받을 모듈. 명령 모듈이 componentPrefix 와 component 를 함께 내보내면
 * customId 의 첫 토막(`요트라면 yacht:...`)으로 여기 걸린다.
 *
 * loadCommands 는 모르는 속성을 그대로 통과시키므로 로더는 손대지 않아도 된다.
 */
const components = new Map();
for (const cmd of commands.values()) {
  if (cmd.componentPrefix && typeof cmd.component === 'function') {
    components.set(cmd.componentPrefix, cmd);
  }
}
if (components.size) console.log(`[봇] 컴포넌트 접두사: ${[...components.keys()].join(', ')}`);

client.once('clientReady', async (c) => {
  console.log(`[봇] 로그인 완료: ${c.user.tag}`);
  console.log(`[봇] API 주소: ${config.api.base}`);

  // 오너 패스코드가 실제로 통하는지 부팅 시 한 번 확인한다. 첫 쓰기 명령이 401 로
  // 실패하는 대신 배포 로그에서 바로 드러나게 하는 것이 목적이다. 실패해도 죽이지 않는다 —
  // 조회 기능은 키 없이도 동작해야 한다.
  await checkOwnerKeys();

  await loadEmoji(c);
});

/**
 * 게임에 쓸 그림 이모지를 찾아 갈아 끼운다.
 *
 * **앱 이모지를 먼저 본다.** 앱 이모지는 앱당 2000개까지라 카드 53장이 들어가고,
 * 서버 슬롯(무료 50칸)을 안 먹으며 어느 서버에서나 쓸 수 있다. 서버 이모지는 예전에
 * 주사위를 거기 올려 뒀기 때문에 뒤로 남겨 둔 폴백이다.
 *
 * 못 찾아도 게임은 돈다 — 주사위는 키캡 숫자, 카드는 `**A**♠️` 로 그린다.
 * 그래서 여기서 실패해도 죽이지 않고 로그만 남긴다.
 */
async function loadEmoji(c) {
  const all = new Map();
  try {
    for (const e of (await c.application.emojis.fetch()).values()) all.set(e.name, e.toString());
  } catch (err) {
    console.warn('[봇] 앱 이모지 확인 실패:', err.message);
  }
  try {
    const guild = await c.guilds.fetch(config.discord.guildId);
    for (const e of (await guild.emojis.fetch()).values()) {
      if (!all.has(e.name)) all.set(e.name, e.toString());   // 앱 쪽이 우선
    }
  } catch (err) {
    console.warn('[봇] 서버 이모지 확인 실패:', err.message);
  }

  const pick = (name) => all.get(name) ?? null;

  // 주사위 — dice1~6, 그리고 남긴 것을 색으로 구분할 dice1k~6k
  const dice = (suffix) =>
    ['', ...Array.from({ length: 6 }, (_, i) => pick(`dice${i + 1}${suffix}`))];
  const faces = dice('');
  const kept = dice('k');
  if (faces.some(Boolean) || kept.some(Boolean)) {
    useCustomFaces(faces, kept);
    console.log(`[봇] 주사위 이모지 ${faces.filter(Boolean).length}/6`
      + ` (남긴 것 ${kept.filter(Boolean).length}/6)`);
  }

  // 카드 — card_as … card_kc 와 뒷면
  const cards = {};
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      const name = emojiName({ rank, suit });
      const e = pick(name);
      if (e) cards[name] = e;
    }
  }
  const back = pick(BACK_NAME);
  if (back) cards[BACK_NAME] = back;
  if (Object.keys(cards).length) {
    useCardEmoji(cards);
    console.log(`[봇] 카드 이모지 ${Object.keys(cards).length}/53`);
  }
}

client.on('interactionCreate', async (interaction) => {
  // 등록해 둔 서버 밖에서 온 것은 무시한다.
  if (interaction.guildId !== config.discord.guildId) return;

  // 버튼과 셀렉트는 commandName 이 없다. customId 접두사로 담당 모듈을 찾는다.
  const isComponent = interaction.isButton() || interaction.isStringSelectMenu();
  const handler = isComponent
    ? components.get(interaction.customId.split(':')[0])
    : commands.get(interaction.commandName);
  if (!handler) return;
  if (!isComponent && !interaction.isAutocomplete() && !interaction.isChatInputCommand()) return;

  // 로그에 쓸 이름. 컴포넌트는 commandName 이 undefined 라 customId 를 대신 쓴다.
  const label = isComponent ? `[${interaction.customId}]` : `/${interaction.commandName}`;

  // 디스코드의 초기 응답 시한은 인터랙션이 "생성된" 시점부터 3초다. 우리가 받기도 전에
  // 게이트웨이에서 지연되면 손쓸 수가 없다. 어디서 시간이 갔는지 구분하려고 도착 시점의
  // 나이를 재 둔다(10062 Unknown interaction 이 났을 때 원인을 좁히는 유일한 단서).
  const age = Date.now() - interaction.createdTimestamp;
  if (age > 1500) console.warn(`[봇] ${label} 인터랙션이 ${age}ms 늦게 도착`);

  try {
    if (interaction.isAutocomplete()) {
      await handler.autocomplete?.(interaction);
      return;
    }
    if (isComponent) {
      await handler.component(interaction);
      return;
    }
    await handler.execute(interaction);
  } catch (err) {
    // 10062 는 시한이 지나 인터랙션이 사라진 것이라 어떤 응답도 보낼 수 없다. 길게 찍지 않는다.
    if (err?.code === 10062) {
      console.error(`[봇] ${label} 응답 시한 초과 (도착 ${age}ms). 응답 불가.`);
      return;
    }
    // 디스코드 API 거절은 스택보다 code/rawError 가 훨씬 중요하다. 눈에 띄게 따로 찍는다.
    if (err?.rawError || err?.code) {
      console.error(
        `[봇] ${label} 디스코드 API 거절`,
        `code=${err.code} status=${err.status ?? '-'} ${err.message}`,
      );
      console.error('     rawError:', JSON.stringify(err.rawError));
    } else {
      console.error(`[봇] ${label} 처리 중 오류:`, err);
    }

    // 둘만 쓰는 비공개 봇이라 원인을 숨길 이유가 없다. 디스코드에 바로 보여주면
    // Railway 로그를 뒤지지 않아도 되고, 대개 code 하나로 원인이 결정된다.
    const detail = [
      err?.code != null ? `code ${err.code}` : null,
      err?.status != null ? `status ${err.status}` : null,
      err?.message,
    ].filter(Boolean).join(' · ');

    // 이미 응답했는지에 따라 보내는 방법이 달라진다. 여기서 또 던지면 조용히 먹히므로 감싼다.
    const payload = {
      embeds: [fail(`처리 중에 문제가 생겼어요.\n\`\`\`\n${detail.slice(0, 1000)}\n\`\`\``)],
    };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('[봇] 오류 응답조차 실패:', e.message);
    }
  }
});

// 처리되지 않은 예외로 프로세스가 조용히 죽는 것을 막는다(Railway 로그에 남기고 계속 산다).
process.on('unhandledRejection', (err) => console.error('[봇] 처리되지 않은 거부:', err));

await client.login(config.discord.token);
