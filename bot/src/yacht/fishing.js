/**
 * fishing — `/요트 낚시` 의 규칙과 판
 *
 * 요트의 주사위와 점수표를 그대로 쓰되 **판의 목적이 다르다.** 점수표의 열세 줄 가운데
 * 하나에 무언가가 숨어 있고, **그 칸을 실제로 적어야** 낚인다. 빗나가면 거리만큼 기척이 온다.
 *
 *   기회 여섯 · 기회마다 굴림 셋 · 낚으면 그 자리에서 끝
 *
 * **요트 판(state.js)과 따로 산다.** 요트는 자리가 둘 이상이어야 하고, NPC 가 두고, 열두 칸을
 * 다 채워야 끝난다 — 셋 다 낚시와 어긋난다. 같이 두면 `start`·`advance`·`finish`·NPC 드라이버에
 * 모드 분기가 여덟 자리 생기고, 그중 하나만 놓쳐도 MT 가 새거나 판이 안 끝난다. 대신 두 판이
 * **한 채널에 같이 열리지 않게** 명령 쪽에서 서로를 본다.
 *
 * 점수는 여전히 `rules.js` 가 낸다. 이 파일이 더하는 것은 셋뿐이다.
 *
 *   1. **적을 수 있는 칸**(`writable`) — 0점을 버려 칸을 떠보는 것을 막는다
 *   2. **거리 힌트**(`hintFor`) — 입력이 `|차이|` 하나뿐이라 위아래를 흘릴 수가 없다
 *   3. **숨은 자리**(casino/fish.js 의 `hide`) — 전설이면 보너스·요트 칸
 */
import { randomBytes } from 'node:crypto';
import {
  newSheet, commit, totals, scoreFor, openCategories, categoryOf,
  UPPER_KEYS, MAX_ROLLS, BONUS_NEED,
} from './rules.js';
import {
  BONUS_ROW, distance, hide, lengthOf, BY_KEY,
} from '../casino/fish.js';

/** 한 판에 던질 수 있는 횟수. 무료 판과 일반 미끼가 이것을 쓴다. */
export const TRIES = 6;

/**
 * 미끼. **하루 무료 다섯 판을 다 쓰고도 더 하고 싶을 때** 한 판을 산다.
 *
 * 고급 미끼는 기회가 하나 더 붙는다 — 그것 말고 달라지는 것은 없다. 전설이 뜰 확률도,
 * 낚이는 것의 무게도 그대로다. 미끼로 확률을 건드리면 "돈으로 전설을 산다" 가 되고,
 * 그러면 5% 를 지키느라 둔 하루 다섯 번이 뜻을 잃는다.
 */
export const BAITS = {
  bait: { tries: TRIES },
  fineBait: { tries: 7 },
};
export const BAIT_KEYS = Object.keys(BAITS);

/** 그 미끼로 여는 판의 기회 수. 미끼가 없으면(무료 판) 기본값. */
export const triesFor = (baitKey) => BAITS[baitKey]?.tries ?? TRIES;

/** 초이스를 쓸 수 있는 눈의 합. */
export const CHOICE_NEED = 21;

/** 위칸을 쓸 수 있는 같은 눈의 개수. */
export const UPPER_NEED = 3;

/** 방치로 닫히기까지. 요트와 같다. */
export const IDLE_MS = 10 * 60 * 1000;

const rounds = new Map();

// ---------------------------------------------------------------- 규칙

/**
 * 그 칸에 적을 수 있는지. **0점을 버리는 길을 막는 것이 전부다** — 그게 되면 다섯 번이 아니라
 * 열두 번 떠볼 수 있고, 낚시가 그냥 순서대로 훑기가 된다.
 *
 *   위칸(1~6)  그 눈이 세 개 이상
 *   초이스      눈의 합 21 이상
 *   나머지      실제로 조합이 됐을 것(점수가 0 이 아닐 것)
 *
 * 보너스는 **적는 칸이 아니라 이루는 칸**이라 여기 오지 않는다.
 */
export function canWrite(sheet, key, dice) {
  if (!dice || key === BONUS_ROW || sheet[key] !== null) return false;
  const cat = categoryOf(key);
  if (!cat) return false;
  if (UPPER_KEYS.includes(key)) {
    return dice.filter((d) => d === cat.face).length >= UPPER_NEED;
  }
  if (key === 'choice') return dice.reduce((a, b) => a + b, 0) >= CHOICE_NEED;
  return scoreFor(key, dice) > 0;
}

/** 지금 눈으로 적을 수 있는 칸들. 셀렉트가 이 목록만 올린다. */
export const writable = (sheet, dice) =>
  openCategories(sheet).filter((k) => canWrite(sheet, k, dice));

/**
 * 빗나갔을 때의 기척.
 *
 * **위아래를 절대 알려 주지 않는다.** 받는 것이 `|줄 차이|` 하나뿐이라 구조적으로 그럴 수가
 * 없다 — 문구를 늘릴 때도 거리 말고 다른 것을 보면 안 된다.
 */
export const NEAR = [
  '줄이 팽팽해졌다가 툭 풀린다. 바로 곁을 스쳐 갔다.',
  '찌가 한 번 크게 잠겼다. 아주 가깝다.',
  '손끝이 찌릿하다. 반 뼘 차이였다.',
];
export const FAINT = [
  '물결이 인다. 멀지 않은 곳에서 지느러미가 움직였다.',
  '수면에 동그란 파문이 퍼진다. 근처에 있다.',
  '물풀이 흔들린다. 무언가 지나간 자리다.',
];
export const NOTHING = [
  '잠잠하다.',
  '미끼만 없어졌다.',
  '물이끼만 걸려 올라온다.',
  '아무 기척도 없다.',
];
/** 전설 판은 칸을 이미 알려 줬다 — 거리가 뜻이 없어 따로 뽑는다. */
export const LEGEND_MISS = [
  '깊은 곳에서 무언가가 이쪽을 본다. 자리를 잘못 짚었다.',
  '물밑의 그림자가 한 번 몸을 튼다. 아직 거기 있다.',
  '줄이 툭 늘어진다. 그것은 미끼를 쳐다보지도 않았다.',
  '커다란 것이 천천히 방향을 바꾼다. 시간이 많지 않다.',
];
export const NO_ROOM = '던질 자리가 없다. 한 번을 그냥 흘려보냈다.';

const one = (list, rand) => list[Math.floor(rand() * list.length)] ?? list[0];

export function hintFor(gap, { legend = false, rand = Math.random } = {}) {
  if (legend) return one(LEGEND_MISS, rand);
  if (gap === 1) return one(NEAR, rand);
  if (gap === 2) return one(FAINT, rand);
  return one(NOTHING, rand);
}

/**
 * 판을 열 때의 지문. 전설이면 **어느 칸인지** 알려 준다.
 *
 * 전설은 백 판에 다섯 번 오는 판이다. 한 줄로 흘려보내면 평범한 판과 구별이 안 가서,
 * 여기서만 여러 줄을 쓴다 — 화면도 색과 제목을 같이 바꾼다(`fishRender.legendOpenEmbed`).
 */
export function openingLine(hidden) {
  if (!hidden.legend) return '물속 어딘가에 한 마리가 있다. 어느 칸인지는 아직 모른다.';
  return hidden.row === BONUS_ROW
    ? [
      '물밑이 무겁다. 강이 통째로 한 뼘 내려앉은 것 같다.',
      '발밑의 자갈이 잘게 울리고, 물살이 한쪽으로만 천천히 끌려간다.',
      '이런 것은 이야기 속에서나 들었다. **소계** 쪽이다.',
    ].join('\n')
    : [
      '수면이 한 번 크게 일렁였다. 물결이 사방으로 퍼지는데 무엇이 지나갔는지는 보이지 않는다.',
      '강가의 새가 전부 날아올랐고, 낚싯줄이 손안에서 저 혼자 떨린다.',
      '평생 한 번 볼까 말까 한 것이 **요트** 칸 밑에서 숨을 쉬고 있다.',
    ].join('\n');
}

/** 전설에 닿는 **유일한 길**. 거리 기척이 뜻이 없는 판이라 이 줄이 그 자리를 대신한다. */
export const legendNeed = (hidden) => (hidden.row === BONUS_ROW
  ? `1~6 칸을 메워 **윗칸 소계 ${BONUS_NEED}**. 여섯 번을 전부 같은 눈 셋으로 채워야 겨우 닿아요.`
  : '**요트 칸에 같은 눈 다섯.** 그 한 수 말고는 닿는 길이 없어요.');

/** 판이 도는 동안 표 위에 남는 한 줄. 무엇을 쫓고 있는지 잊지 않게. */
export const legendBanner = (hidden) => (hidden.row === BONUS_ROW
  ? `✦ **전설** · 소계 ${BONUS_NEED} 에 닿으면`
  : '✦ **전설** · 요트 칸에 같은 눈 다섯');

/**
 * 그 수로 낚였는지.
 *
 * 보통은 **적은 칸이 곧 그 줄**이면 된다. 보너스에 숨은 전설만 다르다 — 적는 칸이 아니므로
 * 위칸을 적고 난 뒤 **소계가 63 을 넘었는지**로 본다. 요트에 숨은 전설은 `canWrite` 가 이미
 * 0점 쓰기를 막고 있어서, 요트 칸을 적었다는 것이 곧 같은 눈 다섯이다.
 */
export function isCatch(hidden, key, sheet) {
  if (hidden.row === BONUS_ROW) return totals(sheet).upper >= BONUS_NEED;
  return key === hidden.row;
}

// ---------------------------------------------------------------- 판

export const get = (channelId) => rounds.get(channelId) ?? null;
export const forChannel = (channelId) => rounds.get(channelId) ?? null;
export const remove = (channelId) => rounds.delete(channelId);

export function touch(round) {
  round.rev += 1;
  round.lastAt = Date.now();
  return round;
}

/**
 * 새 판. **혼자 한다** — 자리도 대기실도 없다.
 *
 * `serial` 은 `f` 로 시작한다. 버튼의 customId 를 요트와 같은 `yacht:` 로 쓰면서도 라우터가
 * 첫 글자만 보고 갈라낼 수 있게 하려는 것이다(요트 쪽은 `y`).
 */
export function create({
  channelId, homeChannelId, guildId, userId, name, color, rand = Math.random,
  tries = TRIES,
}) {
  const round = {
    serial: `f${randomBytes(3).toString('hex')}`,
    rev: 0,
    channelId,
    homeChannelId,
    guildId,
    userId,
    name,
    color,
    message: null,
    phase: 'fishing',            // 'fishing' | 'done'
    sheet: newSheet(),
    dice: null,
    held: [false, false, false, false, false],
    rollsLeft: MAX_ROLLS,
    trail: [],
    turn: 1,
    tries,                       // 이 판의 기회 수(미끼가 정한다)
    triesLeft: tries,
    hidden: hide(rand),          // { key, row, legend } — **화면에 절대 안 나간다**
    log: [],                     // 지나간 기척
    caught: null,                // { key, cm, legend }
    left: null,                  // 오늘 남은 무료 낚시 횟수(서버가 준다)
    bait: null,                  // { key, name, left } — 미끼로 연 판이면
    endedReason: null,           // 'caught' | 'out' | 'cancelled' | 'idle'
    rewarded: false,
    lastAt: Date.now(),
  };
  rounds.set(channelId, round);
  return round;
}

/** 다음 기회. 남은 것이 없으면 판이 끝난다. */
export function nextTurn(round) {
  round.triesLeft -= 1;
  round.turn += 1;
  round.dice = null;
  round.held = [false, false, false, false, false];
  round.rollsLeft = MAX_ROLLS;
  round.trail = [];
  if (round.triesLeft <= 0) end(round, 'out');
  else touch(round);
  return round;
}

export function end(round, reason) {
  round.phase = 'done';
  round.endedReason = reason;
  touch(round);
  return round;
}

/** 낚았다. 길이는 여기서 굴린다. */
export function land(round, key, rand = Math.random) {
  round.caught = { key, cm: lengthOf(key, rand), legend: Boolean(round.hidden.legend) };
  round.firstTry = round.turn === 1;
  end(round, 'caught');
  return round.caught;
}

/**
 * 한 칸에 적는다. `{ caught }` 또는 `{ hint, gap }`.
 *
 * 적을 수 없는 칸이면 `null` 을 준다 — 부르는 쪽이 거절한다. 지나간 셀렉트를 눌렀을 때를
 * 위한 그물이다(rev 가 대부분 걸러 주지만 전부는 아니다).
 */
export function writeTo(round, key, rand = Math.random) {
  if (!canWrite(round.sheet, key, round.dice)) return null;
  const { sheet, gained } = commit(round.sheet, key, round.dice);
  round.sheet = sheet;

  if (isCatch(round.hidden, key, sheet)) {
    const cat = categoryOf(key);
    round.log.push({ label: cat.short, gained, hint: null });
    land(round, round.hidden.key, rand);
    return { caught: round.caught };
  }

  const gap = distance(key, round.hidden.row);
  const hint = hintFor(gap, { legend: round.hidden.legend, rand });
  round.log.push({ label: categoryOf(key).short, gained, hint });
  nextTurn(round);
  return { hint, gap };
}

/** 적을 칸이 하나도 없을 때. 그 기회는 그냥 날아간다. */
export function skipTurn(round) {
  round.log.push({ label: '—', gained: null, hint: NO_ROOM });
  nextTurn(round);
  return { hint: NO_ROOM };
}

/** 방치된 판. 요트와 같은 모양이라 명령 쪽 타이머가 둘을 같이 걷는다. */
export function expired(now = Date.now()) {
  const out = [];
  for (const round of rounds.values()) {
    if (round.phase === 'done') {
      if (now - round.lastAt > IDLE_MS) rounds.delete(round.channelId);
      continue;
    }
    if (now - round.lastAt > IDLE_MS) {
      end(round, 'idle');
      out.push(round);
    }
  }
  return out;
}

/** 낚은 것의 표시 이름·갈래. 화면과 정산이 같이 쓴다. */
export const caughtInfo = (round) => (round.caught ? BY_KEY[round.caught.key] ?? null : null);

export default {
  TRIES, BAITS, BAIT_KEYS, triesFor, CHOICE_NEED, UPPER_NEED, IDLE_MS,
  canWrite, writable, hintFor, openingLine, legendNeed, legendBanner, isCatch,
  create, get, forChannel, remove, touch, writeTo, skipTurn, nextTurn, land, end, expired,
  caughtInfo,
};
