/**
 * MIHEARTI 디스코드 봇 — 진입점
 *
 * 인텐트는 Guilds + GuildVoiceStates 만 쓴다. 모든 기능이 슬래시 명령이라
 * MessageContent 같은 특권 인텐트가 필요 없다(디스코드 승인 절차를 안 밟아도 된다).
 */
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import config from './src/config.js';
import { loadCommands } from './src/loadCommands.js';
import { fail } from './src/embeds.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

const commands = await loadCommands();
console.log(`[봇] 명령 ${commands.size}개 적재: ${[...commands.keys()].join(', ')}`);

client.once('clientReady', (c) => {
  console.log(`[봇] 로그인 완료: ${c.user.tag}`);
  console.log(`[봇] API 주소: ${config.api.base}`);
});

client.on('interactionCreate', async (interaction) => {
  // 등록해 둔 서버 밖에서 온 것은 무시한다.
  if (interaction.guildId !== config.discord.guildId) return;

  const command = interaction.isAutocomplete() || interaction.isChatInputCommand()
    ? commands.get(interaction.commandName)
    : null;
  if (!command) return;

  try {
    if (interaction.isAutocomplete()) {
      await command.autocomplete?.(interaction);
      return;
    }
    await command.execute(interaction);
  } catch (err) {
    console.error(`[봇] /${interaction.commandName} 처리 중 오류:`, err);

    // 이미 응답했는지에 따라 보내는 방법이 달라진다. 여기서 또 던지면 조용히 먹히므로 감싼다.
    const payload = { embeds: [fail('처리 중에 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.')] };
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
