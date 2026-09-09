/**
 * /캐입 — 미겔·마티암과 주고받기
 *
 * 답은 웹훅으로 보낸다. 캐릭터 이름과 초상화를 달고 나와서 봇이 아니라 그 인물이
 * 말하는 것처럼 보인다. 웹훅 만들기는 discord/webhook.js 로 뺐다(요트 NPC 도 쓴다).
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { speak, resetSession, usage, GeminiError } from '../ai/gemini.js';
import { NAME, OTHER } from '../ai/persona.js';
import { sayAsOrPlain } from '../discord/webhook.js';
import { ownerFor } from '../owners.js';
import { fail, base, trunc } from '../embeds.js';

const CHARACTER_CHOICES = [
  { name: '미겔', value: 'migel' },
  { name: '마티암', value: 'matiam' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('캐입')
    .setDescription('미겔·마티암과 이야기합니다.')
    .addSubcommand((s) =>
      s.setName('말').setDescription('말을 겁니다')
        .addStringOption((o) =>
          o.setName('내용').setDescription('건넬 말').setRequired(true))
        .addStringOption((o) =>
          o.setName('상대').setDescription('비우면 내 캐릭터의 상대역이 나옵니다')
            .addChoices(...CHARACTER_CHOICES)))
    .addSubcommand((s) =>
      s.setName('초기화').setDescription('여태 나눈 대화를 잊게 합니다')
        .addStringOption((o) =>
          o.setName('상대').setDescription('비우면 둘 다').addChoices(...CHARACTER_CHOICES)))
    .addSubcommand((s) =>
      s.setName('사용량').setDescription('오늘 Gemini 를 얼마나 썼는지')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const me = ownerFor(interaction.user.id);

    if (sub === '사용량') {
      const u = usage();
      await interaction.reply({
        embeds: [base({
          title: 'Gemini 사용량',
          description: [
            `최근 1분 ${u.minute}${u.minuteResetsIn ? ` (${u.minuteResetsIn}초 뒤 초기화)` : ''}`,
            `오늘 ${u.day}`,
            '',
            '_구글의 실제 한도가 아니라 봇이 스스로 건 안전장치예요._',
            '_`GEMINI_RPM` · `GEMINI_RPD` 로 조정합니다._',
          ].join('\n'),
          footer: u.model,
        })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === '초기화') {
      const who = interaction.options.getString('상대');
      const cleared = resetSession(interaction.channelId, who);
      await interaction.reply({
        embeds: [base({
          description: cleared
            ? `${who ? NAME[who] : '둘'}이(가) 여태 나눈 이야기를 잊었어요.`
            : '지울 대화가 없었어요.',
        })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // ---------------- 말 걸기
    // 상대를 안 고르면 내 캐릭터의 상대역. 겨울이 부르면 마티암, 사백이 부르면 미겔.
    const character = interaction.options.getString('상대') || (me ? OTHER[me] : null);
    if (!character) {
      await interaction.reply({
        embeds: [fail('누구에게 말할지 골라주세요. (오너는 비워두면 상대역이 나옵니다)')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const text = interaction.options.getString('내용').trim();

    // 웹훅으로 답하므로, 내가 뭐라고 했는지는 슬래시 명령 응답에 남긴다.
    // 그래야 대화 흐름이 채널에 보인다.
    await interaction.reply({ content: `> ${trunc(text, 1900)}` });

    let reply;
    try {
      reply = await speak({
        character,
        channelId: interaction.channelId,
        userId: interaction.user.id,
        text,
      });
    } catch (err) {
      // 실패하면 건넨 말만 덩그러니 남지 않도록, 원래 응답에 사유를 붙여 고친다.
      // 따로 숨은 메시지로 보내면 채널에 맥락 없는 인용문만 남는다.
      await interaction.editReply({
        content: `> ${trunc(text, 1900)}`,
        embeds: [fail(err instanceof GeminiError ? err.message : '대답을 받지 못했어요.')],
      });
      return;
    }

    // 웹훅을 못 만들면(권한 부족 등) 일반 메시지로 물러선다. 대답을 버리지는 않는다.
    await sayAsOrPlain(interaction.channel, character, reply, '캐입');
  },
};
