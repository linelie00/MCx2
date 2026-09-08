/**
 * /영화 — 안 쓴 한줄평 확인 · 목록 · 평점 작성
 *
 * 조회는 공개 API 라 누구나 쓸 수 있고, 평점 작성만 오너 전용이다.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMovies, updateMovieRating, abs, ApiError } from '../api.js';
import { OWNER_META, OWNERS, ownerFor } from '../owners.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';

const COMMENT_MAX = 300; // 서버와 같은 값 (movieController.js)

/**
 * 한줄평을 아직 안 쓴 영화.
 *
 * 웹 UI(client/src/Pages/Movie.js:53)와 정확히 같은 술어를 쓴다. 별점은 보지 않는다 —
 * 영화 등록 다이얼로그가 별점을 기본 4로 채워버려서 신호가 되지 않기 때문이다.
 */
const isPending = (movie, owner) =>
  !((movie.ratings && movie.ratings[owner] && movie.ratings[owner].comment) || '').trim();

const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

/** 별 막대는 반올림해서 보여주고, 정확한 값은 숫자로 함께 적는다. */
function stars(n) {
  const v = Number(n) || 0;
  const full = Math.round(v);
  return `${'★'.repeat(full)}${'☆'.repeat(5 - full)} ${v}`;
}

/** 두 사람 평점을 한 덩어리로. 안 쓴 쪽은 그대로 드러낸다. */
function ratingLines(movie) {
  return OWNERS.map((o) => {
    const r = movie.ratings?.[o];
    const comment = (r?.comment || '').trim();
    return `**${OWNER_META[o].label}** ${stars(r?.stars)}\n${comment || '_아직 한줄평이 없어요._'}`;
  }).join('\n\n');
}

/** 0 ~ 5, 0.5 단위 — 서버가 그렇게 반올림하므로 선택지도 그에 맞춘다. */
const STAR_CHOICES = Array.from({ length: 11 }, (_, i) => {
  const v = i / 2;
  return { name: `${v}`, value: v };
});

const OWNER_CHOICES = OWNERS.map((o) => ({ name: OWNER_META[o].label, value: o }));

export default {
  data: new SlashCommandBuilder()
    .setName('영화')
    .setDescription('본 영화와 평점을 다룹니다.')
    .addSubcommand((s) =>
      s.setName('안쓴거').setDescription('한줄평을 아직 안 쓴 영화를 보여줍니다')
        .addStringOption((o) =>
          o.setName('사람').setDescription('기본값은 본인').addChoices(...OWNER_CHOICES)))
    .addSubcommand((s) =>
      s.setName('목록').setDescription('최근에 본 영화')
        .addIntegerOption((o) =>
          o.setName('개수').setDescription('기본 5편').setMinValue(1).setMaxValue(10)))
    .addSubcommand((s) =>
      s.setName('평점').setDescription('별점과 한줄평을 남깁니다 (오너 전용)')
        .addStringOption((o) =>
          o.setName('영화').setDescription('제목으로 찾기').setRequired(true).setAutocomplete(true))
        .addNumberOption((o) =>
          o.setName('별점').setDescription('0~5, 0.5 단위').setRequired(true).addChoices(...STAR_CHOICES))
        .addStringOption((o) =>
          o.setName('한줄평').setDescription(`${COMMENT_MAX}자까지`).setRequired(true))),

  /** 영화 제목 자동완성. 본인이 안 쓴 것을 앞에 올려 고르기 쉽게 한다. */
  async autocomplete(interaction) {
    const typed = (interaction.options.getFocused() || '').toLowerCase();
    let movies = [];
    try {
      movies = await getMovies();
    } catch {
      // 자동완성 실패는 조용히 넘긴다. 명령 자체를 막지 않는다.
    }

    const owner = ownerFor(interaction.user.id);
    const matched = movies.filter((m) => m.title.toLowerCase().includes(typed));

    // 안 쓴 것 먼저, 그 안에서는 최근 본 순
    matched.sort((a, b) => {
      if (owner) {
        const d = Number(isPending(b, owner)) - Number(isPending(a, owner));
        if (d) return d;
      }
      return byDateDesc(a, b);
    });

    await interaction.respond(matched.slice(0, 25).map((m) => ({
      name: trunc(`${m.title} (${m.date})`, 100),
      value: m.id,
    })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const me = ownerFor(interaction.user.id);
    await interaction.deferReply();

    let movies;
    try {
      movies = await getMovies();
    } catch (err) {
      await interaction.editReply({
        embeds: [fail(err instanceof ApiError ? err.message : '사이트에 연결하지 못했어요.')],
      });
      return;
    }

    // ---------------- 안 쓴 것
    if (sub === '안쓴거') {
      const owner = interaction.options.getString('사람') || me;
      if (!owner) {
        await interaction.editReply({
          embeds: [fail('누구 기준인지 알 수 없어요. `사람` 옵션을 골라주세요.')],
        });
        return;
      }

      const pending = movies.filter((m) => isPending(m, owner)).sort(byDateDesc);
      const label = OWNER_META[owner].label;

      if (!pending.length) {
        await interaction.editReply({
          embeds: [base({ title: `${label} — 다 썼어요`, description: '한줄평이 빠진 영화가 없어요.' })],
        });
        return;
      }

      const list = pending
        .map((m) => `**${m.title}** · ${m.date}${m.director ? ` · ${m.director}` : ''}`)
        .join('\n');

      const e = base({
        title: `${label} — 한줄평이 필요한 영화 ${pending.length}편`,
        description: trunc(list, 4096),
      });
      // 포스터가 있으면 가장 최근 것을 곁들인다. 어떤 영화였는지 떠올리기 쉬우라고.
      if (pending[0].poster) e.setThumbnail(abs(pending[0].poster));

      await interaction.editReply({ embeds: [e] });
      return;
    }

    // ---------------- 목록
    if (sub === '목록') {
      const n = interaction.options.getInteger('개수') ?? 5;
      const recent = [...movies].sort(byDateDesc).slice(0, n);

      if (!recent.length) {
        await interaction.editReply({ embeds: [fail('등록된 영화가 없어요.')] });
        return;
      }

      const body = recent.map((m) => {
        const score = OWNERS
          .map((o) => `${OWNER_META[o].label} ${Number(m.ratings?.[o]?.stars) || 0}`)
          .join(' · ');
        return `**${m.title}** · ${m.date}\n${score}`;
      }).join('\n\n');

      const e = base({ title: `최근 본 영화 ${recent.length}편`, description: trunc(body, 4096) });
      if (recent[0].poster) e.setThumbnail(abs(recent[0].poster));
      await interaction.editReply({ embeds: [e] });
      return;
    }

    // ---------------- 평점 (오너 전용)
    if (!me) {
      await interaction.editReply({
        embeds: [fail('평점은 오너만 남길 수 있어요.')],
      });
      return;
    }

    const movieId = interaction.options.getString('영화');
    const starValue = interaction.options.getNumber('별점');
    const comment = interaction.options.getString('한줄평').trim();

    if (comment.length > COMMENT_MAX) {
      await interaction.editReply({
        embeds: [fail(`한줄평은 ${COMMENT_MAX}자까지예요. (지금 ${comment.length}자)`)],
      });
      return;
    }

    // 자동완성을 안 쓰고 직접 입력하면 id 가 아닌 값이 올 수 있다.
    const target = movies.find((m) => m.id === movieId);
    if (!target) {
      await interaction.editReply({
        embeds: [fail('그 영화를 찾지 못했어요. 목록에서 골라주세요.')],
      });
      return;
    }

    try {
      const updated = await updateMovieRating({
        owner: me, movieId, stars: starValue, comment,
      });

      const e = new EmbedBuilder()
        .setColor(OWNER_META[me].color ?? THEME_COLOR)
        .setTitle(`${updated.title} · ${updated.date}`)
        .setDescription(ratingLines(updated));
      if (updated.poster) e.setThumbnail(abs(updated.poster));

      await interaction.editReply({ embeds: [e] });
    } catch (err) {
      await interaction.editReply({
        embeds: [fail(err instanceof ApiError ? err.message : '평점을 저장하지 못했어요.')],
      });
    }
  },
};
