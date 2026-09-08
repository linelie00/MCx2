/**
 * /플리 — 플레이리스트 조회·수정과 음성 재생
 *
 * 조회와 재생은 누구나, 목록·곡 수정은 오너 전용.
 * 음성 갈래는 성격이 많이 달라 handleVoice 로 따로 뺐다.
 */
import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getPlaylists, addTrack, deleteTrack, createPlaylist, updatePlaylist, abs, ApiError,
} from '../api.js';
import { accents } from '../content.js';
import { ownerFor } from '../owners.js';
import {
  connect, enqueue, skip, shuffle, setLoop, leave, getState,
} from '../voice/player.js';
import { resolve } from '../voice/ytsource.js';
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

const LOOP_LABEL = { off: '끄기', one: '한곡', all: '전체' };

/** 색 선택지는 생성 데이터에서 가져온다. 사이트가 색을 추가하면 재생성만 하면 된다. */
const ACCENT_CHOICES = accents.map((a) => ({ name: a.label, value: a.id }));

const VOICE_SUBS = new Set(['재생', '지금', '대기열', '건너뛰기', '섞기', '반복', '정지']);

/**
 * 음성 갈래.
 *
 * 재생 결과를 슬래시 응답 하나로만 알리면 곡이 넘어갈 때마다 사용자가 알 수 없다.
 * 그래서 player 에 콜백을 줘서 채널에 알림을 흘린다.
 */
async function handleVoice(interaction, sub) {
  const guildId = interaction.guildId;
  const s = getState(guildId);

  if (sub === '정지') {
    if (!s) { await interaction.editReply({ embeds: [fail('지금 아무것도 안 틀고 있어요.')] }); return; }
    leave(guildId);
    await interaction.editReply({ embeds: [base({ description: '멈추고 나왔어요.' })] });
    return;
  }

  if (sub === '지금') {
    if (!s?.current) { await interaction.editReply({ embeds: [fail('지금 나오는 곡이 없어요.')] }); return; }
    const t = s.current;
    const e = new EmbedBuilder()
      .setColor(THEME_COLOR)
      .setTitle(trunc(t.title, 256))
      .setURL(`https://youtu.be/${t.videoId}`)
      .setFooter({ text: `대기열 ${s.queue.length}곡 · 반복 ${LOOP_LABEL[s.loop]}` });
    if (t.thumbnail) e.setThumbnail(t.thumbnail);
    await interaction.editReply({ embeds: [e] });
    return;
  }

  if (sub === '대기열') {
    if (!s?.queue.length) { await interaction.editReply({ embeds: [fail('대기열이 비어 있어요.')] }); return; }
    const body = s.queue.slice(0, 15)
      .map((t, i) => `**${i + 1}.** ${mdEscape(trunc(t.title, 70))} · ${dur(t.duration)}`)
      .join('\n');
    const more = s.queue.length > 15 ? `\n\n_그 외 ${s.queue.length - 15}곡_` : '';
    await interaction.editReply({
      embeds: [base({ title: `대기열 ${s.queue.length}곡`, description: trunc(body + more, 4096) })],
    });
    return;
  }

  if (sub === '건너뛰기') {
    const skipped = await skip(guildId);
    await interaction.editReply({
      embeds: skipped
        ? [base({ description: `**${mdEscape(trunc(skipped.title, 200))}** 을(를) 넘겼어요.` })]
        : [fail('넘길 곡이 없어요.')],
    });
    return;
  }

  if (sub === '섞기') {
    const n = shuffle(guildId);
    await interaction.editReply({
      embeds: n ? [base({ description: `대기열 ${n}곡을 섞었어요.` })] : [fail('섞을 곡이 없어요.')],
    });
    return;
  }

  if (sub === '반복') {
    const mode = interaction.options.getString('모드');
    setLoop(guildId, mode);
    await interaction.editReply({ embeds: [base({ description: `반복: ${LOOP_LABEL[mode]}` })] });
    return;
  }

  // ---------------- 재생
  const channel = interaction.member?.voice?.channel;
  if (!channel) {
    await interaction.editReply({ embeds: [fail('먼저 음성 채널에 들어가 주세요.')] });
    return;
  }

  const listId = interaction.options.getString('재생목록');
  const search = interaction.options.getString('검색');
  if (!listId && !search) {
    await interaction.editReply({ embeds: [fail('재생목록을 고르거나 검색어를 적어주세요.')] });
    return;
  }

  let tracks = [];
  try {
    if (listId) {
      const playlists = await getPlaylists();
      const p = playlists.find((x) => x.id === listId);
      if (!p?.tracks.length) {
        await interaction.editReply({ embeds: [fail('그 재생목록에 곡이 없어요.')] });
        return;
      }
      tracks = p.tracks.map((t) => ({
        videoId: t.videoId, title: t.title, duration: t.duration, thumbnail: t.thumbnail,
      }));
    } else {
      const found = await resolve(search);
      tracks = [{
        videoId: found.videoId,
        title: found.title || found.videoId,
        duration: found.duration || 0,
      }];
    }
  } catch (err) {
    await interaction.editReply({
      embeds: [fail(err instanceof ApiError ? err.message : `찾지 못했어요. (${trunc(err.message, 200)})`)],
    });
    return;
  }

  if (interaction.options.getBoolean('섞기')) {
    for (let i = tracks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
  }

  try {
    await connect(channel, (ev) => {
      // 재생 알림은 명령을 부른 채널로 흘린다. 실패해도 재생 자체는 계속 간다.
      const send = (payload) => interaction.channel?.send(payload).catch(() => {});
      if (ev.type === 'playing') {
        send({ embeds: [base({ description: `▶ **${mdEscape(trunc(ev.track.title, 200))}**` })] });
      } else if (ev.type === 'aborted') {
        send({
          embeds: [fail(
            `연달아 재생에 실패해서 멈췄어요. 남은 ${ev.dropped}곡을 비웠습니다.\n`
            + `\`\`\`\n${trunc(ev.reason, 400)}\n\`\`\``,
          )],
        });
      } else if (ev.type === 'failed') {
        send({
          embeds: [fail(
            `**${mdEscape(trunc(ev.track.title, 150))}** 은(는) 지금 재생할 수 없어요. 넘어갑니다.\n`
            + `https://youtu.be/${ev.track.videoId}`
            + (ev.reason ? `\n\`\`\`\n${trunc(ev.reason, 300)}\n\`\`\`` : ''),
          )],
        });
      }
    });
    await enqueue(guildId, tracks);

    await interaction.editReply({
      embeds: [base({
        title: `${tracks.length}곡을 넣었어요`,
        description: tracks.slice(0, 5)
          .map((t, i) => `**${i + 1}.** ${mdEscape(trunc(t.title, 70))}`).join('\n')
          + (tracks.length > 5 ? `\n_그 외 ${tracks.length - 5}곡_` : ''),
        footer: channel.name,
      })],
    });
  } catch (err) {
    await interaction.editReply({
      embeds: [fail(`음성 채널에 들어가지 못했어요. (${trunc(err.message, 200)})`)],
    });
  }
}

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
    // ---- 음성 재생 ----
    .addSubcommand((s) =>
      s.setName('재생').setDescription('음성 채널에서 틉니다')
        .addStringOption((o) =>
          o.setName('재생목록').setDescription('어느 목록').setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('검색').setDescription('유튜브 링크 또는 검색어 (한 곡만)'))
        .addBooleanOption((o) =>
          o.setName('섞기').setDescription('넣을 때 순서를 섞습니다')))
    .addSubcommand((s) => s.setName('지금').setDescription('지금 나오는 곡'))
    .addSubcommand((s) => s.setName('대기열').setDescription('다음에 나올 곡들'))
    .addSubcommand((s) => s.setName('건너뛰기').setDescription('이 곡을 넘깁니다'))
    .addSubcommand((s) => s.setName('섞기').setDescription('대기열 순서를 섞습니다'))
    .addSubcommand((s) =>
      s.setName('반복').setDescription('반복 방식을 바꿉니다')
        .addStringOption((o) =>
          o.setName('모드').setDescription('끄기 / 한곡 / 전체').setRequired(true)
            .addChoices(
              { name: '끄기', value: 'off' },
              { name: '한곡', value: 'one' },
              { name: '전체', value: 'all' },
            )))
    .addSubcommand((s) => s.setName('정지').setDescription('멈추고 음성 채널에서 나갑니다')),

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

    // 음성 관련은 따로 뺀다. 여기 로직과 성격이 많이 다르다.
    if (VOICE_SUBS.has(sub)) {
      await handleVoice(interaction, sub);
      return;
    }

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
