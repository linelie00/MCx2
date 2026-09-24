/**
 * /일상 — 미겔·마티암이 하고 싶은 일을 하나 한다
 *
 *   /일상 캐릭터:미겔
 *
 * 명령한 사람은 **누구의 하루인지만** 고른다. 무엇을 할지는 캐릭터가 정한다(`daily/pick.js`) —
 * 장을 보거나, 누군가에게 선물을 하거나, 가진 재료로 요리·제작을 하거나, 낚시·던전에 가거나,
 * 혼잣말을 하거나, 상대를 불러 수다를 떤다. 요리·제작은 `/요리` 와, 낚시는 `/요트 낚시` 와,
 * 던전은 `/홀덤 던전` 과 같은 규칙·같은 정산이다. **던전에서는 쓰러질 수 있다.**
 * 스레드를 하나 열고 그 안에서 한 장면을 진행한다(`daily/run.js`). 모든 일은 혼잣말로 시작한다.
 *
 * **하루 세 번, 캐릭터마다 따로** — 서버가 센다(`POST /api/accounts/npc-day`). 둘이 하는 일은
 * 부른 쪽 횟수만 쓴다. 횟수는 **시작할 때** 쓴다 — 도중에 저장이 실패해도 돌려주지 않는다.
 *
 * 막는 것
 *   - 쓰러져 있으면 횟수를 안 쓰고 거절한다(서버도 본다)
 *   - 판에 앉아 있거나 이미 다른 하루를 보내는 중이면 거절한다(`seatedAt` — 일상도 판으로 친다)
 *   - 상대가 쓰러졌거나 판에·다른 하루에 있으면 부르지 않는다. 혼자 한다
 *   - 명령한 사람이 판에 앉아 있으면 그 사람에게는 선물하지 않는다(`/양도` 와 같은 까닭)
 *   - 상대가 오늘 이미 여러 번 불려 나갔으면 가끔 쉬고 싶다며 거절한다 — 그러면 혼자 한다
 *
 * 끝나면 **기록**을 남기고(일상 칭호의 전적 — `run.recordOf`), 새로 얻은 칭호가 있으면 스레드에
 * 칭호 카드를 올린다. 요리·낚시·던전 칭호도 여기서 같이 뜬다.
 *
 * 명령한 사람의 몸은 필요 없다 — 쓰러져 있어도 부를 수 있다(`allowDead`).
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import {
  getAccounts, getWeather, tryNpcDay, tryFish, writeDiary,
} from '../api.js';
import { base, fail } from '../embeds.js';
import { NPC_CHOICES, NPC_ID, characterOf, displayOf } from '../casino/accounts.js';
import { OWNER_META } from '../owners.js';
import { seatedAt, seatedMessage } from '../casino/tables.js';
import { isDead, forget } from '../casino/alive.js';
import { forgetBag } from '../casino/bag.js';
import { apply } from '../casino/wallet.js';
import { sayAsOrPlain } from '../discord/webhook.js';
import { josa } from '../farm/requesters.js';
import * as busy from '../daily/busy.js';
import { choose, PARTNER } from '../daily/pick.js';
import {
  runDay, labelOf, recordOf, diaryOf,
} from '../daily/run.js';
import {
  monologue, reply, recipe, judgeMade, canJudge, diary,
} from '../daily/talk.js';
import { resultEmbed } from './make.js';
import { resultEmbed as fishResultEmbed } from '../yacht/fishRender.js';
import * as payout from '../holdem/payout.js';
import { earned as earnedTitles, gained as gainedTitles, totalFor as titleTotal } from '../casino/titles.js';
import { awardCard } from '../casino/titleCard.js';
import { canned, fill } from '../daily/lines.js';

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** 한 줄 읽을 틈. 길면 조금 더 — 대사가 한꺼번에 쏟아지면 장면이 아니라 로그가 된다. */
const pauseFor = (text) => Math.min(4200, 1400 + [...String(text)].length * 45);

const data = new SlashCommandBuilder()
  .setName('일상')
  .setDescription('미겔·마티암이 하고 싶은 일을 하나 합니다 — 캐릭터마다 하루 세 번.')
  .addStringOption((o) => o.setName('캐릭터').setDescription('누구의 하루인지')
    .setRequired(true).addChoices(...NPC_CHOICES));

/** 오늘이 어떤 날인지 — 농장의 계절과 날씨(모든 농장이 같다). 못 읽으면 null. */
async function todayOf() {
  try {
    const t = (await getWeather())?.today;
    if (!t?.season || !t?.weather) return null;
    return { emoji: t.season.emoji, text: `${t.season.name} ${t.season.day}일째, 날씨는 ${t.weather.name}` };
  } catch {
    return null;
  }
}

async function execute(interaction) {
  const id = interaction.options.getString('캐릭터');
  const character = characterOf(id);
  if (!character || !OWNER_META[character]) {
    await interaction.reply({ embeds: [fail('모르는 캐릭터예요.')], flags: MessageFlags.Ephemeral });
    return;
  }
  const name = OWNER_META[character].character;

  // **자리를 먼저 잡는다.** 판에 앉아 있는지 보고 곧바로(await 없이) 하루를 연다 — 사이에
  // await 이 끼면 두 사람이 같은 캐릭터를 동시에 불러 둘 다 통과한다.
  const at = seatedAt(id);
  if (at) {
    await interaction.reply({ embeds: [fail(seatedMessage(name, at))], flags: MessageFlags.Ephemeral });
    return;
  }
  const day = busy.open(interaction.channelId, id);
  try {
    await interaction.deferReply();
    await spend(interaction, day, { id, character, name });
  } finally {
    busy.close(day);
    // 가진 것과 체력이 바뀌었을 수 있다. 다음 자동완성·사망 검사가 서버를 다시 보게 한다.
    for (const who of [...day.seats.map((s) => s.id), interaction.user.id]) {
      forgetBag(who);
      forget(who);
    }
  }
}

/** 하루 한 장면. 자리는 부르는 쪽이 잡아 두었다. */
async function spend(interaction, day, { id, character, name }) {
  const partner = PARTNER[character];
  const partnerId = NPC_ID[partner];
  const color = OWNER_META[character].color;
  const refuse = (msg) => interaction.editReply({ embeds: [fail(msg)] });

  let accounts;
  let today;
  try {
    // 명령한 사람의 계정도 읽는다 — 선물로 만든 것을 받을 칸이 남았는지 봐야 한다.
    [{ accounts }, today] = await Promise.all([getAccounts([id, partnerId, interaction.user.id]), todayOf()]);
  } catch (err) {
    await refuse(`계정을 읽지 못했어요. ${err.message}`);
    return;
  }
  const me = accounts[id];
  const dead = `${name}은(는) 쓰러져 있어요 — 부활의 영약으로 일으켜야 하루를 보낼 수 있어요.`;
  if (isDead(me)) {
    await refuse(dead);
    return;
  }

  let quota;
  try {
    quota = await tryNpcDay(id);
  } catch (err) {
    await refuse(`하루를 시작하지 못했어요. ${err.message}`);
    return;
  }
  if (!quota.ok) {
    await refuse(quota.reason === 'dead' ? dead
      : `${name}은(는) 오늘 하루를 다 보냈어요 (${quota.tries}/${quota.tries}). 한국 시간 0시가 지나면 다시 불러 주세요.`);
    return;
  }

  // 상대가 올 수 있는지 보고 **같은 동기 블록에서** 자리를 잡는다(검사와 잡기 사이에 await 없음).
  const human = displayOf(interaction.user.id, { user: interaction.user, member: interaction.member });
  const pick = (partnerFree) => choose({
    character,
    me,
    // 쓰러진 상대는 부를 수 없다 — 대신 골드가 넉넉하면 부활의 영약을 사다 먹일 수 있다(`dead`).
    partner: {
      account: accounts[partnerId],
      free: partnerFree && !isDead(accounts[partnerId]) && !seatedAt(partnerId),
      dead: partnerFree && isDead(accounts[partnerId]) && !seatedAt(partnerId),
    },
    human: interaction.user.bot ? null : {
      free: !seatedAt(interaction.user.id),
      crafts: accounts[interaction.user.id]?.crafts?.length ?? 0,
    },
    // 요리·제작은 심사관까지 서너 번을 부른다. 지금 막혀 있으면 후보에서 뺀다.
    canMake: canJudge(),
  });
  let choice = pick(true);
  // 오늘 이미 여러 번 불려 나간 상대는 가끔 쉬고 싶어 한다 — 그러면 혼자 할 일을 다시 고른다.
  // 쓰러진 상대를 일으키러 가는 것은 거절할 수가 없다(쓰러져 있다).
  const declined = choice.duo && !choice.plan?.revive && busy.tired(partnerId);
  if (declined) choice = pick(false);
  if (choice.duo) {
    busy.join(day, partnerId);
    busy.noteJoin(partnerId);
  }
  // 새 칭호를 알리려면 **쓰기 전** 칭호가 있어야 한다(칭호는 전적에서 계산한다).
  const involved = [id, ...(choice.duo ? [partnerId] : [])];
  const titlesBefore = Object.fromEntries(involved.map((x) => [
    x, earnedTitles(accounts[x], { npc: true }).map((t) => t.key),
  ]));

  const nth = quota.tries - quota.left;
  const emoji = today?.emoji ?? '☀️';
  await interaction.editReply({
    embeds: [base({ description: `${emoji} ${josa(name, ['이', '가'])} 하루를 시작해요…`, color })],
  });

  // 스레드 이름에는 무엇을 하는지 안 적는다 — 첫 혼잣말에서 드러나야 한다. 끝나면 요약이 알려 준다.
  let room = interaction.channel;
  try {
    if (!room.isThread()) {
      const anchor = await interaction.fetchReply();
      room = await anchor.startThread({ name: `${emoji} ${name}의 하루 · ${nth}/${quota.tries}`, autoArchiveDuration: 1440 });
    }
  } catch (err) {
    console.warn('[일상] 스레드를 못 만들어 채널에서 진행합니다:', err.message);
    room = interaction.channel;
  }
  day.channelId = room.id;
  await sleep(800);

  const io = {
    say: async (who, text) => {
      await sayAsOrPlain(room, who, text, '일상');
      await sleep(pauseFor(text));
    },
    // 여러 줄이면 줄마다 작은 글씨로 — `-#` 는 그 줄에만 걸린다.
    note: async (text) => {
      const small = String(text).split('\n').map((l) => `-# ${l}`).join('\n');
      await room.send({ content: small, allowedMentions: { parse: [] } })
        .catch((err) => console.warn('[일상] 안내 실패:', err.message));
      await sleep(900);
    },
    card: async (mode, craft, info) => {
      await room.send({ embeds: [resultEmbed(mode, craft, info)] })
        .catch((err) => console.warn('[일상] 결과 카드 실패:', err.message));
      await sleep(2500);
    },
    embed: async (card) => {
      await room.send({ embeds: [base(card)] })
        .catch((err) => console.warn('[일상] 카드 실패:', err.message));
      await sleep(2500);
    },
    // 던전의 저장 — `/홀덤 던전` 과 같은 길(`holdem/payout.js`). 체력은 핸드마다, 끝에 넘친 기운·전리품.
    dungeon: {
      met: (who, foe) => payout.metEnemy(who, foe),
      hand: (game) => payout.hand(game).catch((err) => {
        console.warn('[일상] 던전 체력 저장 실패:', err.message);
        return { ok: false };
      }),
      overflow: (game) => payout.settleOverflow(game).catch((err) => {
        console.warn('[일상] 넘친 기운 정산 실패:', err.message);
        return null;
      }),
      won: (who, drops, opts) => payout.dungeonWon(who, drops, opts),
      lost: (who, died) => payout.dungeonLost(who, died),
    },
    fishCard: async (round, extra) => {
      await room.send({ embeds: [fishResultEmbed(round, extra)] })
        .catch((err) => console.warn('[일상] 낚시 카드 실패:', err.message));
      await sleep(2500);
    },
    // 하루 무료 낚시 한 번 — 그 캐릭터 몫에서 쓴다. 못 물어보면 못 던진 것으로 친다.
    tryFish: (who) => tryFish(who).catch((err) => {
      console.warn('[일상] 낚시 횟수를 못 받았어요:', err.message);
      return null;
    }),
    apply,
    monologue,
    reply,
    recipe,
    judge: judgeMade,
    diary,
  };

  const { icon, label } = labelOf(choice);
  const ctx = {
    character,
    partner,
    me,
    partnerAccount: accounts[partnerId],
    human: { id: interaction.user.id, name: human.name },
    choice,
    setting: today?.text ?? null,
    declined,
  };
  let result;
  try {
    result = await runDay(ctx, io);
  } catch (err) {
    console.error('[일상] 진행 중 오류:', err);
    result = { lines: [`_도중에 멈췄어요. ${err.message}_`], failed: true };
  }

  // 기록 — 일상 칭호의 전적과 일기. 도중에 멈춘 장면은 안 남긴다.
  if (!result.failed) {
    const saved = await apply({ bump: recordOf(ctx, result) });
    if (!saved.ok) console.warn('[일상] 기록을 남기지 못했어요');
    const pages = diaryOf(ctx, result, { icon, label });
    if (Object.keys(pages).length) {
      await writeDiary(pages).catch((err) => console.warn('[일상] 일기를 적지 못했어요:', err.message));
    }
    await announceTitles(room, io, involved, titlesBefore);
  }

  // 요약 카드는 **그 사람의 일기**처럼 — 날짜·날씨 한 줄, 일기 글. 숫자가 든 사실은 바닥에 작게.
  // 둘이 한 날은 제목에 같이 적는다. 쓰러진 상대를 일으키러 간 날은 "함께" 가 아니다.
  const together = choice.duo && !choice.plan?.revive
    ? ` · ${josa(OWNER_META[partner].character, ['과', '와'])} 함께` : '';
  const heading = `_${dateLabel()}${today?.text ? ` · ${today.text}` : ''}_`;
  await interaction.editReply({
    embeds: [base({
      title: `${icon} ${name}의 하루 · ${label}${together}`,
      description: result.diary ? `${heading}\n\n${result.diary}` : result.lines.join('\n'),
      color,
      footer: [
        result.diary ? plainFacts(result.lines, ctx.human) : null,
        `오늘 남은 일상 ${quota.left}번 · 한국 시간 0시에 다시 세 번`,
      ].filter(Boolean).join('\n'),
    })],
  }).catch((err) => console.warn('[일상] 요약 실패:', err.message));
}

/** `9월 24일` — 한국 날짜. */
function dateLabel() {
  const [, m, d] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).split('-');
  return `${Number(m)}월 ${Number(d)}일`;
}

/**
 * 요약 줄을 카드 바닥(푸터)에 적을 모양으로. 푸터는 마크다운을 안 그려서 굵은 글씨·기울임 표시를
 * 걷어 내고, 인용 줄(수다의 첫 마디)은 일기에 이미 녹아 있으니 뺀다. 멘션은 이름으로.
 */
function plainFacts(lines, human) {
  return (lines ?? [])
    .filter((l) => !String(l).startsWith('> '))
    .map((l) => String(l)
      .replace(/<@!?(\d+)>/g, (_, uid) => (uid === human?.id ? human.name : '누군가'))
      .replace(/\*\*/g, '')
      .replace(/^_|_$/g, '')
      .trim())
    .filter(Boolean)
    .join(' · ');
}

/**
 * 새 칭호 — 쓰기 전(`before`, 키 목록)과 지금을 견준다. 캐릭터마다 칭호 카드 한 장과 한마디.
 * 일상 전적뿐 아니라 그 장면의 요리·낚시·던전 전적으로 얻은 것도 여기서 뜬다.
 * 못 읽으면 조용히 넘어간다 — 칭호는 전적에서 계산하므로 다음에 `/프로필` 에서 보인다.
 */
async function announceTitles(room, io, ids, before) {
  let after;
  try {
    ({ accounts: after } = await getAccounts(ids));
  } catch {
    return;
  }
  for (const who of ids) {
    const held = earnedTitles(after?.[who], { npc: true });
    const fresh = gainedTitles(before[who] ?? [], held);
    if (!fresh.length) continue;
    const face = displayOf(who);
    const character = characterOf(who);
    await room.send(awardCard({
      name: OWNER_META[character].character,
      avatar: face.avatar,
      avatarFile: face.avatarFile,
      fresh,
      held: held.length,
      total: titleTotal(true),
    })).catch((err) => console.warn('[일상] 칭호 알림 실패:', err.message));
    const line = await io.reply({
      character,
      facts: [`방금 칭호 「${fresh[0].name}」을(를) 얻었다 — ${fresh[0].desc}`],
      ask: '혼잣말 — 새 칭호를 얻고 하는 한마디.',
    });
    await io.say(character, line || fill(canned(character, 'titleGot'), {}));
  }
}

export default { data, execute, allowDead: true };
