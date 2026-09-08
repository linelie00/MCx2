/**
 * /캐입 — 미겔·마티암과 주고받기
 *
 * 답은 웹훅으로 보낸다. 캐릭터 이름과 초상화를 달고 나와서 봇이 아니라 그 인물이
 * 말하는 것처럼 보인다.
 *
 * 웹훅의 avatarURL 은 URL 을 요구하는데 사이트 초상화는 번들 해시가 붙어 빌드마다
 * 파일명이 바뀐다. 그래서 URL 로 거는 대신 **웹훅을 만들 때 이미지를 아바타로 구워
 * 넣는다**(createWebhook 은 로컬 파일을 받는다). 외부 호스팅이 전혀 필요 없다.
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { speak, resetSession, usage, GeminiError } from '../ai/gemini.js';
import { NAME, OTHER } from '../ai/persona.js';
import { ownerFor } from '../owners.js';
import { fail, base, trunc } from '../embeds.js';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

const CHARACTER_CHOICES = [
  { name: '미겔', value: 'migel' },
  { name: '마티암', value: 'matiam' },
];

/**
 * 채널 × 캐릭터마다 웹훅 하나. 한 번 만들면 재사용한다.
 * 봇이 재시작하면 캐시는 비지만, 채널에 이미 있는 웹훅을 찾아 쓰므로 새로 만들지 않는다.
 */
const webhookCache = new Map();

async function getWebhook(channel, character) {
  const cacheKey = `${channel.id}:${character}`;
  const hit = webhookCache.get(cacheKey);
  if (hit) return hit;

  const wanted = NAME[character];
  const existing = await channel.fetchWebhooks();
  let hook = existing.find((w) => w.name === wanted && w.owner?.id === channel.client.user.id);

  if (!hook) {
    const avatar = path.join(ASSETS, `${character}.png`);
    hook = await channel.createWebhook({
      name: wanted,
      // 초상화가 없으면 아바타 없이라도 만든다. 이름만으로도 누가 말하는지는 보인다.
      ...(fs.existsSync(avatar) ? { avatar } : {}),
      reason: '캐입 핑퐁 — 캐릭터로 말하기',
    });
  }

  webhookCache.set(cacheKey, hook);
  return hook;
}

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
        embeds: [base({ title: 'Gemini 사용량', description: `이번 분 ${u.minute}\n오늘 ${u.day}` })],
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

    try {
      const hook = await getWebhook(interaction.channel, character);
      await hook.send({ content: trunc(reply, 2000) });
    } catch (err) {
      // 웹훅을 못 만들면(권한 부족 등) 그냥 봇 메시지로 보낸다. 대답을 버리지는 않는다.
      console.warn('[캐입] 웹훅 실패, 일반 메시지로 대체:', err.message);
      await interaction.followUp({ content: `**${NAME[character]}** ${trunc(reply, 1900)}` });
    }
  },
};
