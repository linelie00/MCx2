/**
 * equip — 설비 (docs/FARM.md §6.4, 4b)
 *
 * 날씨 피해를 막는 골드 소모처. **계정 아이템이 아니라 농장 문서의 필드**다 — 폐농하면 같이
 * 사라진다.
 *   농장 전체   farm.equip.{ rainBarrel, drain } (true) · farm.equip.sprinkler `{ since, week, last }`
 *   밭마다      plot.cover · plot.stakes (true)
 *
 * 값은 기획서 초안(모두 사면 7,550)의 절반쯤으로 낮췄다. 막아 주는 피해가 작다 — 서리는 겨울,
 * 폭풍은 5% 에 키 큰 작물만, 폭우는 뿌리 품질 −10 뿐이다. 60일 판 수익(9천~1만 1천)의 1/3 쯤.
 */
const EQUIPS = [
  { key: 'rainBarrel', name: '빗물통', emoji: '🛢️', lv: 4, gold: 300, per: 'farm', note: '폭염 날에도 물 한 포기에 체력 1' },
  { key: 'cover', name: '덮개', emoji: '⛺', lv: 4, gold: 80, per: 'plot', note: '서리에 제철 아닌 작물이 안 상한다' },
  { key: 'drain', name: '배수로', emoji: '〰️', lv: 6, gold: 300, per: 'farm', note: '폭우 날 뿌리 작물 품질 −10 을 막는다' },
  { key: 'stakes', name: '지지대', emoji: '🎋', lv: 6, gold: 80, per: 'plot', note: '폭풍에 키 큰 작물이 안 쓰러진다' },
  { key: 'sprinkler', name: '스프링클러', emoji: '⛲', lv: 9, gold: 1500, per: 'farm', note: '한 주에 한 번, 물을 못 준 날을 준 날로 친다' },
];
const EQUIP_BY_KEY = Object.fromEntries(EQUIPS.map((e) => [e.key, e]));

/** 빈 설비 — 새 농장과 옛 농장(`upgrade`)이 쓴다. */
const emptyEquip = () => ({ rainBarrel: false, drain: false, sprinkler: null });

module.exports = { EQUIPS, EQUIP_BY_KEY, emptyEquip };
