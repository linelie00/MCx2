/**
 * /그림 — 갤러리 조회
 *
 * 조회는 전부 공개 엔드포인트라 오너 키가 필요 없다.
 * 서버가 주는 url 은 /uploads/x.jpg 처럼 상대경로이므로 반드시 절대화해야 디스코드가 렌더한다.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getImages, getTags, abs, ApiError } from '../api.js';
import { pickOfDay, pickRandom, dayKey } from '../pickOfDay.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';

/** 태그 id → 라벨. 임베드 푸터에 사람이 읽는 이름으로 보여주려고. */
async function tagLabels() {
  const tags = await getTags();
  return Object.fromEntries(tags.map((t) => [t.id, t.label]));
}

/** 앨범이면 표지(items[0]), 영상이면 poster 를 쓴다. 무엇을 보여줄지 한곳에서 정한다. */
function pictureOf(image) {
  const cover = image.items?.length ? image.items[0] : image;
  return {
    // 영상은 임베드에 넣을 수 없어 poster 를 대신 건다.
    still: abs(cover.type === 'video' ? cover.poster : cover.url),
    // 영상은 본문에 절대 URL 을 평문으로 같이 보내야 디스코드가 플레이어를 편다.
    video: cover.type === 'video' ? abs(cover.url) : null,
  };
}

function imageEmbed(image, labels, { title, footerExtra } = {}) {
  const { still } = pictureOf(image);
  const parts = [];

  if (image.items?.length) parts.push(`앨범 · ${image.items.length}장 중 1장`);
  if (image.type === 'video') parts.push('영상');

  const names = (image.tags || []).map((id) => labels[id] || id);
  if (names.length) parts.push(names.join(' · '));

  if (image.createdAt) parts.push(image.createdAt.slice(0, 10));
  if (footerExtra) parts.push(footerExtra);

  const e = new EmbedBuilder().setColor(THEME_COLOR);
  if (title) e.setTitle(title);
  if (still) e.setImage(still);
  if (parts.length) e.setFooter({ text: trunc(parts.join(' · '), 2048) });
  return e;
}

/** 태그 옵션 자동완성. 캐시 덕분에 3초 시한 안에 든다. */
async function autocompleteTag(interaction) {
  const typed = (interaction.options.getFocused() || '').toLowerCase();
  let tags = [];
  try {
    tags = await getTags();
  } catch {
    // 자동완성은 실패해도 조용히 빈 목록. 명령 자체를 막지 않는다.
  }
  const matched = tags
    .filter((t) => t.label.toLowerCase().includes(typed) || t.id.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((t) => ({ name: t.label, value: t.id }));
  await interaction.respond(matched);
}

export default {
  data: new SlashCommandBuilder()
    .setName('그림')
    .setDescription('갤러리에서 그림을 꺼내옵니다.')
    .addSubcommand((s) =>
      s.setName('오늘').setDescription('오늘의 그림 (하루 동안 같은 그림이 나옵니다)')
        .addStringOption((o) =>
          o.setName('태그').setDescription('특정 태그 안에서만').setAutocomplete(true)))
    .addSubcommand((s) =>
      s.setName('랜덤').setDescription('무작위로 한 장')
        .addStringOption((o) =>
          o.setName('태그').setDescription('특정 태그 안에서만').setAutocomplete(true)))
    .addSubcommand((s) =>
      s.setName('태그').setDescription('태그 목록과 장수를 보여줍니다')),

  autocomplete: autocompleteTag,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // 갤러리는 첫 호출에서 572장을 받아온다. 3초 안에 못 끝날 수 있으니 먼저 접수한다.
    await interaction.deferReply();

    let images;
    let labels;
    try {
      [images, labels] = await Promise.all([getImages(), tagLabels()]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '사이트에 연결하지 못했어요.';
      await interaction.editReply({ embeds: [fail(msg)] });
      return;
    }

    if (sub === '태그') {
      const tags = await getTags();
      const counts = tags
        .map((t) => `${t.label} · ${images.filter((i) => (i.tags || []).includes(t.id)).length}장`)
        .join('\n');
      await interaction.editReply({
        embeds: [base({
          title: `태그 ${tags.length}개 · 전체 ${images.length}장`,
          description: trunc(counts, 4096),
        })],
      });
      return;
    }

    const tag = interaction.options.getString('태그');
    const pool = tag ? images.filter((i) => (i.tags || []).includes(tag)) : images;

    if (!pool.length) {
      await interaction.editReply({
        embeds: [fail(tag ? `"${labels[tag] || tag}" 태그에는 그림이 없어요.` : '갤러리가 비어 있어요.')],
      });
      return;
    }

    const today = sub === '오늘';
    const image = today ? pickOfDay(pool) : pickRandom(pool);
    const { video } = pictureOf(image);

    await interaction.editReply({
      // 영상은 임베드에 못 넣으므로 본문에 링크를 같이 보내 플레이어가 펴지게 한다.
      content: video || undefined,
      embeds: [imageEmbed(image, labels, {
        title: today ? '오늘의 그림' : null,
        footerExtra: today ? dayKey() : null,
      })],
    });
  },
};
