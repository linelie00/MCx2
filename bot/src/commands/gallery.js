/**
 * /그림 — 갤러리 조회
 *
 * 조회는 전부 공개 엔드포인트라 오너 키가 필요 없다.
 * 서버가 주는 url 은 /uploads/x.jpg 처럼 상대경로이므로 반드시 절대화해야 디스코드가 렌더한다.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getImages, getTags, uploadImages, abs, ApiError } from '../api.js';
import { pickOfDay, pickRandom, dayKey } from '../pickOfDay.js';
import { base, fail, trunc, THEME_COLOR } from '../embeds.js';
import { ownerFor } from '../owners.js';
import { isImage, isVideo, humanSize, appendAll } from '../attachments.js';

/** 슬래시 명령은 첨부를 배열로 못 받아서 자리를 미리 만들어 둔다. */
const MAX_FILES = 5;

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

/**
 * 태그 옵션 자동완성. 캐시 덕분에 3초 시한 안에 든다.
 *
 * 올리기에서는 태그를 쉼표로 여러 개 적을 수 있어서, 이미 적은 부분은 두고 마지막
 * 조각만 완성해 준다. 그래서 후보의 value 가 "기존, 후보" 형태가 된다.
 */
async function autocompleteTag(interaction) {
  const raw = interaction.options.getFocused() || '';
  let tags = [];
  try {
    tags = await getTags();
  } catch {
    // 자동완성은 실패해도 조용히 빈 목록. 명령 자체를 막지 않는다.
  }

  const multi = interaction.options.getSubcommand() === '올리기';
  const parts = raw.split(',');
  const typed = (multi ? parts[parts.length - 1] : raw).trim().toLowerCase();
  const prefix = multi ? parts.slice(0, -1).map((s) => s.trim()).filter(Boolean) : [];

  const matched = tags
    .filter((t) => !prefix.includes(t.label))
    .filter((t) => t.label.toLowerCase().includes(typed) || t.id.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((t) => (multi
      ? { name: [...prefix, t.label].join(', '), value: [...prefix, t.label].join(', ') }
      : { name: t.label, value: t.id }));

  await interaction.respond(matched.map((c) => ({ ...c, name: trunc(c.name, 100) })));
}

/**
 * 사람이 적은 태그 문자열을 태그 id 로 바꾼다.
 * 라벨로도 id 로도 받아준다. 모르는 이름은 조용히 버리지 않고 돌려준다 —
 * 오타로 태그 없이 올라가 버리면 나중에 찾기 어렵다.
 */
function resolveTags(input, tags) {
  const names = (input || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ids = [];
  const unknown = [];

  for (const name of names) {
    const hit = tags.find((t) => t.label === name || t.id === name
      || t.label.toLowerCase() === name.toLowerCase());
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else {
      unknown.push(name);
    }
  }
  return { ids, unknown };
}

/** 올리기 — 디스코드 첨부를 사이트 갤러리로 다시 올린다. */
async function upload(interaction) {
  const me = ownerFor(interaction.user.id);
  if (!me) {
    await interaction.editReply({ embeds: [fail('갤러리 업로드는 오너만 할 수 있어요.')] });
    return;
  }

  const files = [];
  for (let i = 1; i <= MAX_FILES; i += 1) {
    const att = interaction.options.getAttachment(`파일${i}`);
    if (att) files.push(att);
  }

  const bad = files.filter((a) => !isImage(a) && !isVideo(a));
  if (bad.length) {
    await interaction.editReply({
      embeds: [fail(`올릴 수 없는 형식이 있어요: ${bad.map((a) => `${a.name} (${a.contentType || '알 수 없음'})`).join(', ')}`)],
    });
    return;
  }

  let tags;
  try {
    tags = await getTags();
  } catch (err) {
    await interaction.editReply({
      embeds: [fail(err instanceof ApiError ? err.message : '사이트에 연결하지 못했어요.')],
    });
    return;
  }

  const { ids, unknown } = resolveTags(interaction.options.getString('태그'), tags);
  if (unknown.length) {
    await interaction.editReply({
      embeds: [fail(
        `모르는 태그예요: ${unknown.join(', ')}\n`
        + `쓸 수 있는 태그: ${tags.map((t) => t.label).join(' · ')}`,
      )],
    });
    return;
  }

  const group = (interaction.options.getBoolean('묶기') ?? false) && files.length >= 2;

  try {
    const form = new FormData();
    await appendAll(form, 'files', files);   // 첨부 URL 은 만료되므로 지금 바로 받는다
    const created = await uploadImages({ owner: me, form, tags: ids, group });

    const first = created[0];
    const total = files.reduce((a, f) => a + f.size, 0);
    const e = base({
      title: group ? `앨범 1개 (${files.length}장)` : `${created.length}장 올렸어요`,
      description: ids.length
        ? `태그: ${ids.map((id) => tags.find((t) => t.id === id)?.label || id).join(' · ')}`
        : '_태그 없음_',
      footer: humanSize(total),
    });
    if (first) {
      const { still } = pictureOf(first);
      if (still) e.setImage(still);
    }
    await interaction.editReply({ embeds: [e] });
  } catch (err) {
    await interaction.editReply({
      embeds: [fail(err instanceof ApiError ? err.message : `올리지 못했어요. (${err.message})`)],
    });
  }
}

export default {
  // 사이트 도구 — 세계관 밖이다
  allowDead: true,
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
      s.setName('태그').setDescription('태그 목록과 장수를 보여줍니다'))
    .addSubcommand((s) => {
      s.setName('올리기').setDescription('갤러리에 올립니다 (오너 전용)');
      // 슬래시 명령은 첨부를 배열로 못 받는다. 자리를 여러 개 만들어 둘 수밖에 없다.
      for (let i = 1; i <= MAX_FILES; i += 1) {
        s.addAttachmentOption((o) =>
          o.setName(`파일${i}`).setDescription(i === 1 ? '올릴 그림/영상' : '더 올릴 파일')
            .setRequired(i === 1));
      }
      s.addStringOption((o) =>
        o.setName('태그').setDescription('쉼표로 여러 개').setAutocomplete(true));
      s.addBooleanOption((o) =>
        o.setName('묶기').setDescription('여러 장을 앨범 한 덩어리로 (기본 아니오)'));
      return s;
    }),

  autocomplete: autocompleteTag,

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    // 갤러리는 첫 호출에서 572장을 받아온다. 3초 안에 못 끝날 수 있으니 먼저 접수한다.
    await interaction.deferReply();

    if (sub === '올리기') {
      await upload(interaction);
      return;
    }

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
