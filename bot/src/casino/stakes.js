/**
 * stakes — 판돈 등급
 *
 * 블랙잭도 홀덤도 값만 다르고 구조가 같다. 판을 열 때 하나 고르면 그 판이 끝날 때까지
 * 안 바뀐다(`game.stakes`). 판 도중에 판돈이 바뀌면 이미 건 돈의 뜻이 달라진다.
 *
 * **홀덤 기준으로 등급마다 비율이 같다** — 앉는 골드는 50BB, 최소 입장은 10BB.
 * 그래서 어느 자리에 앉든 게임의 느낌이 같고, 배수만 달라진다. `holdem/ai.js` 가
 * 50BB 를 전제로 맞춰져 있는 것도 이 덕에 등급마다 다시 손볼 필요가 없다.
 *
 * **블랙잭 최소 베팅은 반드시 짝수다.** 블랙잭 3:2 는 `bet * 2.5`, 서렌더와
 * 인슈어런스는 `bet / 2` 라서, 홀수면 지갑에 소수가 들어온다.
 * 베팅 버튼은 최소 베팅의 1·2·4·10배 — 지금 쓰던 50·100·200·500 과 같은 비율이다.
 *
 * 미겔·마티암은 하루 한 번 1000까지만 채워지므로, **딴 것을 모으기 전에는 미들 위로
 * 못 앉는다.** 파산 방지선이지 용돈이 아니라서 그렇다. 이긴 만큼은 그대로 쌓인다.
 */

/** 베팅 버튼. 최소 베팅의 몇 배씩 둘지. */
const BET_STEPS = [1, 2, 4, 10];

const tier = ({ key, name, sb, unit }) => ({
  key,
  name,
  unit,                                   // 블랙잭 베팅 단위 = 최소 베팅
  minBet: unit,
  betUnits: BET_STEPS.map((m) => unit * m),
  sb,
  bb: sb * 2,
  stack: sb * 100,                        // 50BB
  minBuyIn: sb * 20,                      // 10BB — 이만큼 없으면 못 앉는다
});

export const STAKES = {
  micro: tier({ key: 'micro', name: '마이크로', sb: 2, unit: 10 }),
  low: tier({ key: 'low', name: '로우', sb: 10, unit: 50 }),
  mid: tier({ key: 'mid', name: '미들', sb: 50, unit: 250 }),
  high: tier({ key: 'high', name: '하이', sb: 200, unit: 1000 }),
};

/** 안 고르면 이것. 지금까지 쓰던 값이라 아무것도 안 바뀐 것처럼 보인다. */
export const DEFAULT_STAKES = 'low';

/**
 * 그 등급의 값. **반드시 복사해서 준다.**
 *
 * 그냥 `STAKES[key]` 를 주면 판이 **모듈에 하나뿐인 객체를 물고 앉는다.** 토너먼트가
 * 블라인드를 올리려고 `game.stakes.bb` 하나를 고치는 순간, 같은 프로세스에서 돌던
 * 현금 판도 블랙잭도 같이 바뀐다. 한 줄로 막아 둔다.
 */
export const stakesOf = (key) => ({ ...(STAKES[key] ?? STAKES[DEFAULT_STAKES]) });

/**
 * 던전 자리. **`STAKES` 에 안 넣는다** — 넣으면 `STAKES_CHOICES` 를 같이 쓰는
 * 블랙잭에도 `/블랙잭 시작 판돈:던전` 이 생긴다.
 *
 * **블라인드 2/4 에서 시작해 토너먼트처럼 오른다**(state.beginHand). 체력 100 이면
 * 25BB 로 앉는 셈이다.
 *
 * 처음에는 1/2 고정이었다(체력 100 = 50BB). 그랬더니 **판이 안 끝났다** — 접어도
 * 체력 1~2 만 나가니 둘 다 좋은 패를 기다리기만 한다. 재 보니 엘리트는 절반이
 * 20핸드를 넘기고 셋에 하나는 40핸드를 넘겼다. 2/4 에서 6핸드마다 올리면 일반은
 * 절반이 7핸드, 엘리트는 11핸드 안에 끝나고 40핸드 넘는 판은 거의 없다.
 * **승률은 거의 그대로다** — 짧게 만들 뿐 쉽게 만들지는 않는다.
 */
export const DUNGEON = tier({ key: 'dungeon', name: '던전', sb: 2, unit: 5 });

/**
 * 토너먼트 블라인드 사다리. 고른 등급의 `sb` 에 이 배수를 곱한다.
 *
 * **안 올리면 판이 안 끝난다.** 스택이 50BB 인 채로 두면 한 명이 남을 때까지 수백
 * 핸드가 걸린다. 뒤로 갈수록 성큼성큼 올라가 반드시 끝나게 한다.
 */
const LEVELS = [1, 2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200];

/** 몇 핸드마다 한 칸 올릴지. */
export const LEVEL_EVERY = 6;

/**
 * `level` 단계의 블라인드. **`sb`·`bb` 와 `level` 만 바뀐다.**
 *
 * `stack`·`minBuyIn` 은 판을 열 때만 쓰이므로 1단계 값 그대로 두고, `unit`·`minBet`·
 * `betUnits` 는 **블랙잭 전용**이라 홀덤이 아예 안 본다.
 */
export function atLevel(base, level) {
  const mult = LEVELS[Math.min(Math.max(0, level), LEVELS.length - 1)];
  const sb = base.sb * mult;
  return { ...base, sb, bb: sb * 2, level };
}

export const TOP_LEVEL = LEVELS.length - 1;

/** 슬래시 명령 선택지. 고를 때 숫자가 보여야 무엇을 고르는지 안다. */
export const STAKES_CHOICES = Object.values(STAKES).map((s) => ({
  name: `${s.name} — 블라인드 ${s.sb}/${s.bb} · 앉으면 ${s.stack}골드`,
  value: s.key,
}));

/** 그 자리에 앉을 만큼 있는지. 없으면 사유, 되면 null. */
export function tooPoor(stakes, gold, who = '그쪽') {
  if (gold >= stakes.minBuyIn) return null;
  return `${who}은(는) ${stakes.name} 자리에 앉기엔 골드가 모자라요.`
    + ` **${stakes.minBuyIn}골드**는 있어야 하는데 지금 ${gold}골드예요.`;
}

export default {
  STAKES, DEFAULT_STAKES, stakesOf, STAKES_CHOICES, tooPoor,
  DUNGEON, atLevel, LEVEL_EVERY, TOP_LEVEL,
};
