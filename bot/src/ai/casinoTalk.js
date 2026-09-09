/**
 * casinoTalk — 카지노 NPC 가 판을 보고 말한다
 *
 * 요트(gameTalk)와 같은 Gemini 를 쓰지만 **캔드 대사를 대체하지 않고 섞인다.**
 * 여기서 null 이 오면 부르는 쪽이 미리 써 둔 줄을 대신 낸다. 그래서 한도가 차든
 * 키가 없든 API 가 죽든 판은 늘 말이 있는 채로 돈다 — 요트에서는 대사가 그냥 비었다.
 *
 *   프롬프트  요트와 같은 말투 조각(voice.js) + 그 게임의 상황(아래 GAMES)
 *   분당 한도 계량의 65% 까지만. 요트(70%)보다 조금 더 남긴다 — 카지노 게임은 한 핸드에
 *             대사 자리가 훨씬 많아 안 막으면 계량을 혼자 다 쓴다.
 *   실패      **조용히 null.** 절대 던지지 않는다.
 *
 * `npc` 딜러는 여기 오지 않는다. 페르소나가 없는 진행 역할이라 지을 말투가 없고,
 * 짧고 사무적인 것이 그 자리의 성격이다.
 *
 * **게임을 인자로 받는다.** 카지노 게임이 여럿이 되면서 "블랙잭을 하는 중이다" 와
 * 블랙잭 용어 규칙을 파일에 박아 둘 수 없게 됐다. 게임마다 다른 것만 GAMES 로 모으고
 * 나머지(성격·어미·되풀이 방지)는 그대로 공유한다.
 */
import { generate, checkRate, noteCall } from './client.js';
import { voicePromptFor, NAME } from './persona.js';
import { ATTITUDE, RULES, clean, recentOf } from './voice.js';
import config from '../config.js';

/** 사람 몫으로 남겨 둘 분당 한도 비율. /캐입 이 굶지 않게. */
const RESERVE = 0.35;

/** 한 판에서 NPC 하나가 Gemini 로 할 수 있는 말의 최대 수. 폭주 방지용. */
export const MAX_LINES = 60;

/**
 * 게임마다 다른 것 — 무엇을 하는 중인지, 어느 자리인지, 그 게임에만 있는 말 규칙.
 *
 * 성격(ATTITUDE)과 어미(SPEECH)는 게임을 안 가리므로 voice.js 가 들고 있다.
 * 여기 있는 것은 **판이 달라지면 달라지는 것뿐**이다.
 *
 * ROLE 은 "어느 자리에 앉았는지" 다. 딜러석이든 손님석이든 같은 사람이라 태도까지
 * 자리마다 다시 쓸 이유는 없다.
 */
const GAMES = {
  blackjack: {
    doing: '카지노 "bard" 에서 블랙잭을 하는 중이다.',
    role: {
      dealer: {
        migel: [
          '카지노 bard 의 딜러다. 내가 카드를 돌리고 정산한다.',
          '진행은 규칙대로 공정하게 한다. 다만 입까지 공정할 필요는 없다.',
          '집(카지노)이 나다. 내가 이기면 그건 내가 딴 것이다.',
        ],
      },
      player: {
        migel: [
          '오늘은 손님 자리에 앉았다. 딜러는 npc 가 맡았다.',
          '모처럼 받는 쪽이라 신이 나 있다.',
        ],
        matiam: [
          '손님 자리에 앉아 카드를 받는다.',
        ],
      },
    },
    rules: [
      '- **Hit, Stand, Double, Split, Surrender, Insurance, Blackjack, Bust 는 영어 그대로** 쓴다.',
      '  "히트" "스탠드" 처럼 한글로 적지 않는다.',
      '- 카드는 A, 2~10, J, Q, K 로 부른다. 무늬는 말해도 되고 안 해도 된다.',
      '- 숫자를 꼭 읊을 필요는 없다. 읊고 싶으면 읊는다.',
      // 영어 표기를 못 박아 두면 모델이 그 단어들을 자랑하듯 매 줄에 끼워 넣는다.
      // 실제로 딜러 미겔이 인사·베팅·차례 알림을 전부 "Hit 하시겠습니까, 아니면
      // Stand 하시겠습니까~?" 로 끝냈다. 선택지는 버튼에 이미 보인다.
      '- **선택지를 나열하지 않는다.** "Hit 하시겠습니까, Stand 하시겠습니까" 하고',
      '  묻지 마라. 무엇을 고를 수 있는지는 화면에 이미 나와 있다.',
      '- 위 영어 단어들은 **그 일이 실제로 일어났을 때만** 쓴다. 억지로 끼워 넣지 않는다.',
    ],
  },
};

const systemFor = (game, character, role, variant) => {
  const g = GAMES[game];
  return [
    voicePromptFor(character, variant),
    '',
    '## 지금 하고 있는 것',
    g.doing,
    ...(g.role[role]?.[character] ?? g.role.player[character]),
    '',
    '## 판에서의 나',
    ...ATTITUDE[character],
    ...RULES(character),
    ...g.rules,
  ].join('\n');
};

/**
 * 부팅 시 자리 × 변형별로 조립해 둔다.
 * 매번 같은 예시를 보여 주면 모델이 그중 한 문장을 틀로 굳혀 버린다(요트에서 겪었다).
 */
const VARIANTS = 6;
const SYSTEM = {};
for (const [game, g] of Object.entries(GAMES)) {
  for (const [role, byCharacter] of Object.entries(g.role)) {
    for (const character of Object.keys(byCharacter)) {
      SYSTEM[`${game}:${role}:${character}`] = Array.from(
        { length: VARIANTS }, (_, i) => systemFor(game, character, role, i),
      );
    }
  }
}
const systemOf = (game, character, role, variant) => {
  const pool = SYSTEM[`${game}:${role}:${character}`] ?? SYSTEM[`${game}:player:${character}`];
  return pool?.[Math.abs(Math.floor(variant)) % VARIANTS] ?? null;
};

/**
 * 한도와 집계.
 *
 * **막혀도 로그를 남기지 않는다.** 요트에서는 한도에 걸리면 대사가 통째로 비니까
 * 경고가 필요했지만, 여기서는 캔드 대사로 물러서는 것이 설계된 정상 경로다.
 * 한 핸드에 몇 번씩 걸리는 것이 당연해서 찍으면 로그만 뒤덮인다.
 * 얼마나 쓰고 있는지는 client.meter() 로 언제든 볼 수 있다.
 */
/** 모르는 게임을 한 번만 경고한다. 매 대사 자리마다 찍으면 로그가 뒤덮인다. */
const warned = new Set();

function allowed(said) {
  if (!config.gemini.apiKey) return false;
  if (said.length >= MAX_LINES) return false;
  if (checkRate({ reserve: RESERVE })) return false;
  noteCall();
  return true;
}

/**
 * 한 줄 지어 온다. 못 하면 **null** — 부르는 쪽이 캔드 대사로 물러선다.
 *
 * `game` 은 GAMES 의 키다. 모르는 게임이면 조용히 null — 대사가 없을 뿐 판은 돈다.
 * situation 은 지금 판이 어떻게 생겼고 방금 무슨 일이 있었는지를 적은 메모이고,
 * 만드는 곳은 각 게임의 lines.js 다 — 이 파일은 판을 읽을 줄 모른다.
 */
export async function line({ game, character, role = 'player', situation, said = [] }) {
  // 기본값을 두지 않는다. 두면 새 게임이 game 을 빠뜨렸을 때 조용히 블랙잭 프롬프트로
  // 돌아가서, 포커 판에서 미겔이 Hit/Stand 를 말하는 식으로 티 안 나게 망가진다.
  if (!GAMES[game]) {
    if (!warned.has(game)) { warned.add(game); console.warn(`[casinoTalk] 모르는 게임: ${game}`); }
    return null;
  }
  const system = systemOf(game, character, role, said.length);
  if (!system) return null;                       // 페르소나 없는 화자(npc)
  if (!allowed(said)) return null;

  const text = [
    situation,
    recentOf(said),
    // 말투 예시가 전부 상대에게 말을 거는 대사라, 규칙을 시스템 프롬프트에만
    // 적어 두면 자기가 한 일을 남이 한 일로 읽는다. 마지막 줄에서 못을 박는다.
    '\n"지금" 항목이 내가 반응할 일이다. 다른 사람이 한 일이면 그 사람에게 말을 건다.',
    '한 줄로 답해라. 한두 문장이면 넉넉하다. 번호나 설명은 붙이지 않는다.',
    '선택지를 나열하며 묻지 않는다.',
  ].filter(Boolean).join('\n');

  try {
    const res = await generate({
      system,
      contents: [{ role: 'user', parts: [{ text }] }],
      temperature: 1.2,
      maxOutputTokens: 1200,
    });
    // 여러 줄로 오면 두 줄까지만 쓴다 — 캔드 대사에도 두세 줄짜리가 있어서
    // 줄바꿈 자체는 이상하지 않지만, 길어지면 판이 대사에 묻힌다.
    const rows = String(res.text || '').split('\n').map(clean).filter(Boolean);
    if (!rows.length) return null;
    return rows.slice(0, 2).join('\n');
  } catch (err) {
    console.warn(`[${game}] ${NAME[character] ?? character} 대사 실패:`,
      err.message?.slice(0, 120));
    return null;
  }
}

export default { line, MAX_LINES };
