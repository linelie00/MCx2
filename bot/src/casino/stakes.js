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

export const stakesOf = (key) => STAKES[key] ?? STAKES[DEFAULT_STAKES];

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

export default { STAKES, DEFAULT_STAKES, stakesOf, STAKES_CHOICES, tooPoor };
