/**
 * /플리 — 플레이리스트 조회·수정
 *
 * 조회는 누구나, 목록·곡 수정은 오너 전용.
 *
 * 봇이 음성 채널에서 직접 트는 기능은 뺐다. 유튜브가 데이터센터 IP 를 차단해
 * Railway 에서 안정적으로 동작하지 않았고(쿠키를 넣어도 40분쯤 뒤 다시 막혔다),
 * 추출 도구를 두는 것 자체가 호스트 약관에 걸릴 소지가 있었다.
 * 대신 /플리 듣기 가 사이트·유튜브 링크로 안내한다.
 * 되살리려면 이 기능을 뺀 커밋을 revert 하면 된다(가정용 IP 에서는 잘 동작했다).
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getPlaylists, addTrack, deleteTrack, createPlaylist, updatePlaylist, abs, ApiError,
} from '../api.js';
import { accents } from '../content.js';
import config from '../config.js';
import { ownerFor } from '../owners.js';
import { base, fail, trunc, mdEscape, THEME_COLOR } from '../embeds.js';

const TITLE_MAX = 60;   // 서버와 같은 값 (playlistController.js)
const DESC_MAX = 300;
const NOTE_MAX = 300;

/** 초 → 3:07 */
const dur = (s) => {
  const n = Number(s) || 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};

const totalDur = (tracks) => {
  const s = tracks.reduce((a, t) => a + (Number(t.duration) || 0), 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};

const watchUrl = (t) => `https://youtu.be/${t.videoId}`;

/** 색 선택지는 생성 데이터에서 가져온다. 사이트가 색을 추가하면 재생성만 하면 된다. */
const ACCENT_CHOICES = accents.map((a) => ({ name: a.label, value: a.id }));

async function loadPlaylists(interaction) {
  try {
    return await getPlaylists();
  } catch (err) {
    await interaction.editReply({
      embeds: [fail(err instanceof ApiError ? err.message : '사이트에 연결하지 못했어요.')],
    });
    return null;
  }
}

export default {
  // 사이트 도구 — 세계관 밖이다
  allowDead: true,
  data: new SlashCommandBuilder()
    .setName('플리')
    .setDescription('플레이리스트를 봅니다.')
    .addSubcommand((s) =>
      s.setName('목록').setDescription('재생목록 전체'))
    .addSubcommand((s) =>
      s.setName('보기').setDescription('재생목록의 곡들')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) =>
      s.setName('곡추가').setDescription('유튜브 링크로 곡을 넣습니다 (오너 전용)')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('링크').setDescription('유튜브 주소 또는 영상 id').setRequired(true))
        .addStringOption((o) =>
          o.setName('메모').setDescription(`${NOTE_MAX}자까지`)))
    .addSubcommand((s) =>
      s.setName('곡삭제').setDescription('곡을 뺍니다 (오너 전용)')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('곡').setDescription('뺄 곡').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) =>
      s.setName('만들기').setDescription('재생목록을 새로 만듭니다 (오너 전용)')
        .addStringOption((o) =>
          o.setName('제목').setDescription(`${TITLE_MAX}자까지`).setRequired(true))
        .addStringOption((o) =>
          o.setName('설명').setDescription(`${DESC_MAX}자까지`))
        .addStringOption((o) =>
          o.setName('색').setDescription('강조색').addChoices(...ACCENT_CHOICES)))
    .addSubcommand((s) =>
      s.setName('수정').setDescription('재생목록 정보를 고칩니다 (오너 전용)')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('제목').setDescription(`${TITLE_MAX}자까지`))
        .addStringOption((o) => o.setName('설명').setDescription(`${DESC_MAX}자까지`))
        .addStringOption((o) =>
          o.setName('색').setDescription('강조색').addChoices(...ACCENT_CHOICES)))
    .addSubcommand((s) =>
      s.setName('듣기').setDescription('사이트와 유튜브에서 들을 수 있는 링크를 줍니다')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setRequired(true).setAutocomplete(true))),

  /**
   * 재생목록과 곡 모두 자동완성한다.
   * 곡 목록은 이미 고른 재생목록에 딸린 것만 보여줘야 하므로 다른 옵션 값을 읽는다.
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    let playlists = [];
    try {
      playlists = await getPlaylists();
    } catch {
      // 자동완성 실패는 조용히. 명령 자체를 막지 않는다.
    }
    const typed = (focused.value || '').toLowerCase();

    if (focused.name === '재생목록') {
      await interaction.respond(
        playlists
          .filter((p) => p.title.toLowerCase().includes(typed))
          .slice(0, 25)
          .map((p) => ({ name: trunc(`${p.title} (${p.tracks.length}곡)`, 100), value: p.id })),
      );
      return;
    }

    // 곡 — 재생목록을 아직 안 골랐으면 보여줄 게 없다.
    const playlistId = interaction.options.getString('재생목록');
    const tracks = playlists.find((p) => p.id === playlistId)?.tracks ?? [];
    await interaction.respond(
      tracks
        .filter((t) => t.title.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((t) => ({ name: trunc(t.title, 100), value: t.id })),
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const me = ownerFor(interaction.user.id);
    await interaction.deferReply();

    // ---------------- 목록
    if (sub === '목록') {
      const playlists = await loadPlaylists(interaction);
      if (!playlists) return;

      if (!playlists.length) {
        await interaction.editReply({ embeds: [fail('재생목록이 없어요.')] });
        return;
      }

      const body = playlists.map((p) => {
        const meta = `${p.tracks.length}곡 · ${totalDur(p.tracks)}`;
        return `**${mdEscape(p.title)}** · ${meta}${p.description ? `\n${mdEscape(p.description)}` : ''}`;
      }).join('\n\n');

      await interaction.editReply({
        embeds: [base({ title: `재생목록 ${playlists.length}개`, description: trunc(body, 4096) })],
      });
      return;
    }

    // ---------------- 보기
    // ---------------- 듣기 (링크 안내)
    //
    // 봇이 음성 채널에서 직접 틀어 주던 기능은 뺐다. 유튜브가 데이터센터 IP 를 막아
    // Railway 에서 안정적으로 동작하지 않았고, 추출 도구를 두는 것 자체가 호스트 약관에
    // 걸릴 소지가 있었다. 대신 들을 수 있는 곳으로 안내한다.
    if (sub === '듣기') {
      const playlists = await loadPlaylists(interaction);
      if (!playlists) return;

      const p = playlists.find((x) => x.id === interaction.options.getString('재생목록'));
      if (!p) {
        await interaction.editReply({ embeds: [fail('그 재생목록을 찾지 못했어요.')] });
        return;
      }
      if (!p.tracks.length) {
        await interaction.editReply({ embeds: [fail('그 재생목록에 곡이 없어요.')] });
        return;
      }

      // 유튜브는 영상 id 를 이어 붙이면 임시 재생목록을 만들어 준다. 한 링크로 전곡을 들을 수 있다.
      // 목록이 아주 길면 URL 이 길어지므로 50곡에서 끊는다.
      const ids = p.tracks.map((t) => t.videoId).filter(Boolean).slice(0, 50);
      const youtubeAll = `https://www.youtube.com/watch_videos?video_ids=${ids.join(',')}`;

      const lines = [
        `**[사이트에서 듣기](${config.site}/playlist)** — 미니 플레이어가 페이지를 옮겨도 따라옵니다`,
        `**[유튜브에서 전곡 듣기](${youtubeAll})** — ${ids.length}곡`,
        '',
        ...p.tracks.slice(0, 10).map((t, i) =>
          `${i + 1}. [${mdEscape(trunc(t.title, 60))}](${watchUrl(t)}) · ${dur(t.duration)}`),
        p.tracks.length > 10 ? `_그 외 ${p.tracks.length - 10}곡_` : '',
      ].filter(Boolean);

      const e = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle(p.title)
        .setDescription(trunc(lines.join('\n'), 4096))
        .setFooter({ text: `${p.tracks.length}곡 · ${totalDur(p.tracks)}` });
      if (p.tracks[0]?.thumbnail) e.setThumbnail(p.tracks[0].thumbnail);

      await interaction.editReply({ embeds: [e] });
      return;
    }

    if (sub === '보기') {
      const playlists = await loadPlaylists(interaction);
      if (!playlists) return;

      const p = playlists.find((x) => x.id === interaction.options.getString('재생목록'));
      if (!p) {
        await interaction.editReply({ embeds: [fail('그 재생목록을 찾지 못했어요.')] });
        return;
      }

      const body = p.tracks.length
        ? p.tracks.map((t, i) =>
          `**${i + 1}.** [${mdEscape(trunc(t.title, 70))}](${watchUrl(t)}) · ${dur(t.duration)}`
          + `${t.note ? `\n　${mdEscape(t.note)}` : ''}`).join('\n')
        : '_아직 곡이 없어요._';

      const e = new EmbedBuilder()
        .setColor(THEME_COLOR)
        .setTitle(p.title)
        .setDescription(trunc(body, 4096))
        .setFooter({ text: `${p.tracks.length}곡 · ${totalDur(p.tracks)}` });
      if (p.description) e.setAuthor({ name: trunc(p.description, 256) });
      // 첫 곡 썸네일로 분위기를 낸다. 유튜브 썸네일은 이미 절대 URL 이다.
      if (p.tracks[0]?.thumbnail) e.setThumbnail(p.tracks[0].thumbnail);

      await interaction.editReply({ embeds: [e] });
      return;
    }

    // ---------------- 여기서부터 오너 전용
    if (!me) {
      await interaction.editReply({ embeds: [fail('이 명령은 오너만 쓸 수 있어요.')] });
      return;
    }

    try {
      if (sub === '곡추가') {
        const playlistId = interaction.options.getString('재생목록');
        const url = interaction.options.getString('링크').trim();
        const note = (interaction.options.getString('메모') || '').trim();

        const track = await addTrack({ owner: me, playlistId, url, note });

        const e = new EmbedBuilder()
          .setColor(THEME_COLOR)
          .setTitle(trunc(track.title, 256))
          .setURL(watchUrl(track))
          .setDescription(`${mdEscape(track.channel)} · ${dur(track.duration)}${note ? `\n${mdEscape(note)}` : ''}`)
          .setFooter({ text: '곡을 추가했어요' });
        if (track.thumbnail) e.setThumbnail(track.thumbnail);

        await interaction.editReply({ embeds: [e] });
        return;
      }

      if (sub === '곡삭제') {
        const playlistId = interaction.options.getString('재생목록');
        const trackId = interaction.options.getString('곡');

        // 지운 뒤에는 제목을 알 수 없으니 미리 찾아 둔다.
        const playlists = await getPlaylists();
        const track = playlists.find((p) => p.id === playlistId)?.tracks
          .find((t) => t.id === trackId);

        await deleteTrack({ owner: me, playlistId, trackId });
        await interaction.editReply({
          embeds: [base({ description: `**${track ? mdEscape(trunc(track.title, 200)) : '곡'}** 을(를) 뺐어요.` })],
        });
        return;
      }

      if (sub === '만들기') {
        const title = interaction.options.getString('제목').trim();
        const description = (interaction.options.getString('설명') || '').trim();
        const accent = interaction.options.getString('색');

        if (title.length > TITLE_MAX) {
          await interaction.editReply({ embeds: [fail(`제목은 ${TITLE_MAX}자까지예요.`)] });
          return;
        }

        const p = await createPlaylist({ owner: me, title, description, accent });
        await interaction.editReply({
          embeds: [base({
            title: p.title,
            description: p.description || '_설명 없음_',
            footer: '재생목록을 만들었어요',
          })],
        });
        return;
      }

      // ---------------- 수정
      const playlistId = interaction.options.getString('재생목록');
      const patch = {};
      for (const [opt, key] of [['제목', 'title'], ['설명', 'description'], ['색', 'accent']]) {
        const v = interaction.options.getString(opt);
        if (v != null) patch[key] = v.trim();
      }

      if (!Object.keys(patch).length) {
        await interaction.editReply({ embeds: [fail('바꿀 항목을 하나는 골라주세요.')] });
        return;
      }

      const p = await updatePlaylist({ owner: me, playlistId, patch });
      await interaction.editReply({
        embeds: [base({
          title: p.title,
          description: p.description || '_설명 없음_',
          footer: `${Object.keys(patch).length}개 항목을 고쳤어요`,
        })],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [fail(err instanceof ApiError ? err.message : '처리하지 못했어요.')],
      });
    }
  },
};
