/**
 * /대사 — 오늘의 대사 / 랜덤 / 찾기
 *
 * 오늘·랜덤은 큐레이션 풀(quotes.json)에서, 찾기는 전체 467줄(lines.json)에서 본다.
 * 큐레이션 풀에는 한 줄짜리(line)와 실제로 오간 주고받기(pair)가 섞여 있다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { EmbedBuilder } from 'discord.js';
import { quotes, lines } from '../content.js';
import { OWNER_META } from '../owners.js';
import { pickOfDay, pickRandom, dayKey } from '../pickOfDay.js';
import { trunc, base, fail } from '../embeds.js';

const NAME = { migel: '미겔', matiam: '마티암' };

/** 한 줄짜리 명대사 */
function lineEmbed(q, footerExtra) {
  return new EmbedBuilder()
    .setColor(OWNER_META[q.speaker].color)
    .setAuthor({ name: NAME[q.speaker] })
    .setDescription(trunc(q.text, 4096))
    .setFooter({ text: trunc([q.session, footerExtra].filter(Boolean).join(' · '), 2048) });
}

/** 주고받기 — 한 임베드에 두 줄을 화자와 함께 넣는다. 색은 먼저 말한 쪽. */
function pairEmbed(q, footerExtra) {
  const body = q.lines
    .map((l) => `**${NAME[l.speaker]}**\n${l.text}`)
    .join('\n\n');
  return new EmbedBuilder()
    .setColor(OWNER_META[q.lines[0].speaker].color)
    .setDescription(trunc(body, 4096))
    .setFooter({ text: trunc([q.session, footerExtra].filter(Boolean).join(' · '), 2048) });
}

const render = (q, footerExtra) =>
  (q.type === 'pair' ? pairEmbed(q, footerExtra) : lineEmbed(q, footerExtra));

export default {
  data: new SlashCommandBuilder()
    .setName('대사')
    .setDescription('미하티의 대사를 꺼내옵니다.')
    .addSubcommand((s) =>
      s.setName('오늘').setDescription('오늘의 명대사 (하루 동안 같은 대사가 나옵니다)'))
    .addSubcommand((s) =>
      s.setName('랜덤').setDescription('명대사 중 무작위로 하나')
        .addStringOption((o) =>
          o.setName('화자').setDescription('특정 인물의 대사만')
            .addChoices({ name: '미겔', value: 'migel' }, { name: '마티암', value: 'matiam' })))
    .addSubcommand((s) =>
      s.setName('찾기').setDescription('전체 대사에서 검색합니다 (467줄)')
        .addStringOption((o) =>
          o.setName('검색어').setDescription('찾을 말').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === '오늘') {
      const q = pickOfDay(quotes);
      await interaction.reply({ embeds: [render(q, dayKey())] });
      return;
    }

    if (sub === '랜덤') {
      const speaker = interaction.options.getString('화자');
      // pair 는 두 사람이 다 나오므로, 화자를 지정하면 그 사람이 낀 것만 남긴다.
      const pool = speaker
        ? quotes.filter((q) => (q.type === 'pair'
          ? q.lines.some((l) => l.speaker === speaker)
          : q.speaker === speaker))
        : quotes;

      const q = pickRandom(pool);
      if (!q) {
        await interaction.reply({ embeds: [fail('해당하는 대사가 없어요.')] });
        return;
      }
      await interaction.reply({ embeds: [render(q)] });
      return;
    }

    // 찾기 — 큐레이션이 아니라 원본 전체에서
    //
    // 임베드를 여러 개 보내는 유일한 갈래라 응답이 무거운 편이다. 디스코드의 초기 응답 시한은
    // 3초뿐이고 실제로 여기서 Unknown interaction(10062) 이 났었다. deferReply 로 먼저
    // 접수만 해 두면 시한이 15분으로 늘어난다.
    await interaction.deferReply();

    const term = interaction.options.getString('검색어').trim();
    const hits = lines.filter((l) => l.text.includes(term));

    if (!hits.length) {
      await interaction.editReply({ embeds: [fail(`"${trunc(term, 50)}" 가 들어간 대사를 못 찾았어요.`)] });
      return;
    }

    // 제약이 두 가지다: 메시지당 임베드 10개, 그리고 모든 임베드 글자수 합 6000자.
    // 대사에 1500자가 넘는 줄이 있어서 5개만 담아도 6000자를 넘길 수 있다.
    // 여유를 두고 5000자까지만 채우고, 못 담은 만큼은 개수로 알린다.
    const BUDGET = 5000;
    const embeds = [];
    let used = 0;
    let shown = 0;

    for (const l of hits) {
      if (embeds.length >= 5) break;
      const text = trunc(l.text, 4096);
      const footer = trunc([l.session, l.scene].filter(Boolean).join(' · '), 2048);
      const cost = text.length + footer.length + NAME[l.speaker].length;
      // 최소 한 개는 담는다. 첫 대사가 아무리 길어도 빈손으로 돌려보내지 않는다.
      if (embeds.length && used + cost > BUDGET) break;

      embeds.push(new EmbedBuilder()
        .setColor(OWNER_META[l.speaker].color)
        .setAuthor({ name: NAME[l.speaker] })
        .setDescription(text)
        .setFooter({ text: footer }));
      used += cost;
      shown += 1;
    }

    if (hits.length > shown) {
      embeds.push(base({ description: `그 외 ${hits.length - shown}줄이 더 있어요.` }));
    }
    await interaction.editReply({ embeds });
  },
};
