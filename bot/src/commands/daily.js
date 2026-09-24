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
 *
 * 명령한 사람의 몸은 필요 없다 — 쓰러져 있어도 부를 수 있다(`allowDead`).
 */
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAccounts, getWeather, tryNpcDay, tryFish } from '../api.js';
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
import { runDay, labelOf } from '../daily/run.js';
import {
  monologue, reply, recipe, judgeMade, canJudge,
} from '../daily/talk.js';
import { resultEmbed } from './make.js';
import { resultEmbed as fishResultEmbed } from '../yacht/fishRender.js';
import * as payout from '../holdem/payout.js';

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
  const choice = choose({
    character,
    me,
    // 쓰러진 상대는 부를 수 없다 — 대신 골드가 넉넉하면 부활의 영약을 사다 먹일 수 있다(`dead`).
    partner: {
      account: accounts[partnerId],
      free: !isDead(accounts[partnerId]) && !seatedAt(partnerId),
      dead: isDead(accounts[partnerId]) && !seatedAt(partnerId),
    },
    human: interaction.user.bot ? null : {
      free: !seatedAt(interaction.user.id),
      crafts: accounts[interaction.user.id]?.crafts?.length ?? 0,
    },
    // 요리·제작은 심사관까지 서너 번을 부른다. 지금 막혀 있으면 후보에서 뺀다.
    canMake: canJudge(),
  });
  if (choice.duo) busy.join(day, partnerId);

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
  };

  const { icon, label } = labelOf(choice);
  let result;
  try {
    result = await runDay({
      character,
      partner,
      me,
      partnerAccount: accounts[partnerId],
      human: { id: interaction.user.id, name: human.name },
      choice,
      setting: today?.text ?? null,
    }, io);
  } catch (err) {
    console.error('[일상] 진행 중 오류:', err);
    result = { lines: [`_도중에 멈췄어요. ${err.message}_`] };
  }

  await interaction.editReply({
    embeds: [base({
      title: `${icon} ${name}의 하루 · ${label}`,
      description: result.lines.join('\n'),
      color,
      footer: `오늘 남은 일상 ${quota.left}번 · 한국 시간 0시에 다시 세 번`,
    })],
  }).catch((err) => console.warn('[일상] 요약 실패:', err.message));
}

export default { data, execute, allowDead: true };
