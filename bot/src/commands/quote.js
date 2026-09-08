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

    // 결과는 임베드 하나에 모아 담는다.
    //
    // 처음엔 대사마다 임베드를 하나씩 만들었는데(6개), 디스코드가 그 페이로드에
    // 일관되게 HTTP 500 을 돌려줬다. 형식 오류(DiscordAPIError)가 아니라 저쪽 서버
    // 에러라 우리가 고칠 수 있는 건 모양뿐이었다. 한 덩어리로 보내면 문제도 없고
    // 검색 결과로서 읽기도 낫다.
    //
    // 세션 로그라 한 줄이 1500자를 넘기도 한다. 검색 결과에서는 어느 대사인지만
    // 알면 되므로 줄당 200자로 자른다. 전문은 /대사 랜덤 이나 사이트에서 본다.
    const PER_LINE = 200;
    const MAX = 5;
    const shown = hits.slice(0, MAX);

    const body = shown
      .map((l) => {
        const where = [l.session, l.scene].filter(Boolean).join(' · ');
        return `**${NAME[l.speaker]}** · ${where}\n${trunc(l.text, PER_LINE)}`;
      })
      .join('\n\n');

    const more = hits.length > shown.length
      ? `\n\n_그 외 ${hits.length - shown.length}줄이 더 있어요._`
      : '';

    await interaction.editReply({
      embeds: [base({
        title: `"${trunc(term, 60)}" — ${hits.length}줄`,
        description: trunc(body + more, 4096),
      })],
    });
  },
};
