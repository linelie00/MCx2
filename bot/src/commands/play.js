/**
 * /주사위, /뽑기 — 세션용 도구
 *
 * 외부 의존이 없고 API도 안 부른다. 명령 라우팅과 임베드 배관이 제대로 도는지
 * 확인하기에 가장 좋아서 가장 먼저 만든다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { randomInt } from 'node:crypto';
import { base } from '../embeds.js';

const dice = {
  data: new SlashCommandBuilder()
    .setName('주사위')
    .setDescription('주사위를 굴립니다.')
    .addIntegerOption((o) =>
      o.setName('면').setDescription('몇 면체인지 (기본 6)').setMinValue(2).setMaxValue(1000))
    .addIntegerOption((o) =>
      o.setName('개수').setDescription('몇 개를 굴릴지 (기본 1)').setMinValue(1).setMaxValue(20))
    .addIntegerOption((o) =>
      o.setName('보정').setDescription('합계에 더하거나 뺄 값')),

  async execute(interaction) {
    const sides = interaction.options.getInteger('면') ?? 6;
    const count = interaction.options.getInteger('개수') ?? 1;
    const bonus = interaction.options.getInteger('보정') ?? 0;

    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1));
    const sum = rolls.reduce((a, b) => a + b, 0) + bonus;

    // 굴린 눈을 다 보여준다 — 세션에서 판정 근거로 쓰이므로 합계만 주면 안 된다.
    const detail = count > 1 || bonus
      ? `${rolls.join(' + ')}${bonus ? (bonus > 0 ? ` + ${bonus}` : ` - ${-bonus}`) : ''}`
      : null;

    await interaction.reply({
      embeds: [base({
        title: `${sum}`,
        description: detail,
        footer: `${count}d${sides}${bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : ''}`,
      })],
    });
  },
};

const draw = {
  data: new SlashCommandBuilder()
    .setName('뽑기')
    .setDescription('항목 중에서 무작위로 뽑습니다.')
    .addStringOption((o) =>
      o.setName('항목').setDescription('쉼표로 구분해 적어주세요').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('개수').setDescription('몇 개를 뽑을지 (기본 1)').setMinValue(1).setMaxValue(20))
    .addBooleanOption((o) =>
      o.setName('중복').setDescription('같은 항목이 여러 번 나와도 되는지 (기본 아니오)')),

  async execute(interaction) {
    const items = interaction.options.getString('항목')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (items.length < 2) {
      await interaction.reply({
        embeds: [base({ title: '항목이 부족해요', description: '쉼표로 구분해 두 개 이상 적어주세요.' })],
      });
      return;
    }

    const allowDup = interaction.options.getBoolean('중복') ?? false;
    const want = interaction.options.getInteger('개수') ?? 1;
    const count = allowDup ? want : Math.min(want, items.length);

    const picked = [];
    if (allowDup) {
      for (let i = 0; i < count; i += 1) picked.push(items[randomInt(items.length)]);
    } else {
      // 중복 없이 뽑을 땐 목록을 복사해 하나씩 빼낸다.
      const pool = [...items];
      for (let i = 0; i < count; i += 1) picked.push(...pool.splice(randomInt(pool.length), 1));
    }

    await interaction.reply({
      embeds: [base({
        title: picked.join(' · '),
        footer: `${items.length}개 중 ${picked.length}개${allowDup ? ' (중복 허용)' : ''}`,
      })],
    });
  },
};

export default [dice, draw];
