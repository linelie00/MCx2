/**
 * items — 아이템 명부
 *
 * 「아이템」 시트를 그대로 옮긴 것이다. 계정에는 **개수만** 저장되고(`items: { key: n }`)
 * 이름·값·설명은 전부 여기서 읽는다 — 칭호와 같은 규약이다.
 *
 * **key 는 바꾸지 않는다.** 저장되는 것이 이 문자열이라, 고치면 사람들이 가진 물건이
 * 통째로 사라진다. 이름은 얼마든지 고쳐도 된다.
 *
 *   kind   소비 · 잡화 · 재료
 *   cat    재료만. 진열대(`CATS`) — 상점이 이걸로 칸을 나눈다
 *   price  **상점 값 하나로 사고 판다.** 살 때 내는 돈이자 팔 때 받는 돈이다.
 *          0 이면 상점에 아예 안 나온다
 *   sell   플레이어가 **팔 수** 있는가. 회복약처럼 살 수는 있어도 못 파는 것이 있다
 *   shop   재료만. `true` 면 **상점에서 판다.** 밀가루·설탕처럼 가게에서 사는 물건이다
 *   loot   `false` 면 **던전에서 안 나온다.** 안 적으면 나온다. 이야기용 물건(피·수배지·
 *          열쇠)과 가공이 끝난 보석이 여기 든다 — 던전 바닥에 루비가 굴러다니면 안 된다.
 *          가게에서만 파는 재료(밀가루·후추…)도 여기 든다
 *   poison 독. 1 약함(배탈) · 2 강함 · 3 치명. `/요리` 에 넣으면 **먹을 때까지 모른다** —
 *          잘 손질했으면 멀쩡하고, 아니면 아프거나 죽는다(`casino/crafts.js`)
 *   monster 괴식. 벌레·지네·도마뱀 눈 같은 것. 이걸로 잘 만들면 「던전밥」
 *   heal   먹었을 때 HP 증감. 숫자 하나면 그만큼, `[a, b]` 면 a~b 사이에서 무작위.
 *          **음수는 깎인다** — 원석이나 열쇠를 먹으면 아픈 게 당연하다
 *
 * 시트에서 여덟을 뺐다. 회복력이 날짜꼴로 깨져 있던 셋(아이스크림·고고고·따꼼약)과
 * 값이 1.111111111 이던 하나는 시트가 값을 잃은 것이고, 값이 없던 요리 넷(전사의 스튜·
 * 바다 루비·지네 담금주·투명 드래곤 스튜)은 아예 뺐다.
 *
 * **재료 42종은 시트에 없던 것이다.** 곡물·고기·채소·꿀·향신료처럼 요리하기 좋은 것들로,
 * 날로 먹으면 대개 조금만 차고 날고기·날가루·향신료는 오히려 아프다. 가게 물건(밀가루·
 * 설탕·기름)은 상점에서만, 들에서 나는 것(베리·송이·날고기)은 던전에서만, 흔한 것
 * (감자·꿀·마늘)은 양쪽에서 얻는다.
 * 설명 끝에 붙어 있던 트위터 핸들도 뺐다 — 남의 계정을 아이템 설명에 박아 둘 이유가 없다.
 */

/** 모두의 HP 최대치. 아직 HP 를 쓰는 곳이 없다 — heal 을 읽을 때가 오면 이 값이 천장이다. */
export const MAX_HP = 100;

/**
 * 재료의 진열대. 상점의 사기 목록이 이 순서로 칸을 나눈다.
 *
 * **셀렉트 한 칸에 25개가 한도라** 재료를 한 목록에 다 넣을 수 없다. 칸마다 25를 넘지
 * 않게 묶었다(`check-items` 가 본다).
 */
export const CATS = [
  { key: 'grain', label: '곡물·가루', icon: '🌾' },
  { key: 'meat', label: '고기·알·해산물', icon: '🍖' },
  { key: 'veg', label: '채소·과일', icon: '🥕' },
  { key: 'sweet', label: '유제품·감미료', icon: '🍯' },
  { key: 'spice', label: '향신료·조미료', icon: '🧂' },
];

export const ITEMS = [
  { key: 'potionSmall',     name: '소형 회복약',              kind: '소비', price:  450, sell: false, heal: [15, 20],   desc: "젤린의 제약과 연금술'에서 자랑스레 만들어 낸, 상처를 치유하는 영약." },
  { key: 'potionMedium',    name: '중형 회복약',              kind: '소비', price:  550, sell: false, heal: [20, 40],   desc: '젤린의 어쩌구에서 만든 더 좋은 상처 치유 영약.' },
  { key: 'potionLarge',     name: '고급 회복약',              kind: '소비', price:  600, sell: false, heal: [40, 60],   desc: '젤린인가 뭔가가 만든 탁월한 치유력의 영약.' },
  { key: 'potionRevive',    name: '부활의 영약',              kind: '소비', price: 1000, sell: false, heal: [100, 100], desc: '한 번 마시면 3일 동안 밤을 샌 사람도 말짱해지고 전신 골절도 단번에 치료하는 탁월한 피로회복과 치유 효과를 가진 영약. 죽은 사람도 살려낼 수 있다. (물론, 사망 방지 마법이 걸려 있다면!)' },
  { key: 'bait',            name: '일반 미끼',                kind: '소비', price:   10, sell: false, loot: false, heal: 0, desc: '지렁이 한 통. 하루치 낚시를 다 쓰고도 한 판 더 던지고 싶을 때 쓴다. 기회는 여섯 번.' },
  { key: 'fineBait',        name: '고급 미끼',                kind: '소비', price:  100, sell: false, loot: false, heal: 0, desc: '무엇이 무엇을 좋아하는지 아는 사람이 만든 것. 비린내가 진해서 주머니에 오래 넣어 두면 곤란하다. 한 판에 기회가 일곱 번.' },
  { key: 'prettyMushroom',  name: '이쁘니 버섯',              kind: '재료', cat: 'veg',   price:   10, sell: true,  heal: -15,        poison: 1, desc: '알록달록하고 예쁘다. 포자를 들이키면 요정들이 나타나 머리 속에서 흥얼거리는 것 같다. 랄랄라... 다 함께 버섯 춤을 춰 봐요.' },
  { key: 'twig',            name: '나뭇가지',                 kind: '잡화', price:    1, sell: true,  heal: -1,         desc: '쉽게 부러지는 나뭇가지. 상점에 팔면 무려 1골드를 얻을 수 있다!' },
  { key: 'redFeather',      name: '새빨간 깃털',              kind: '잡화', price:    5, sell: true,  heal: 0,          desc: '깃펜으로 자주 쓰이는, 정열적인 색깔의 깃털. 미친딱부리도요새의 것이다.' },
  { key: 'acorn',           name: '도토리',                   kind: '재료', cat: 'veg',   price:    1, sell: true,  heal: 1,          desc: '동글동글.' },
  { key: 'wetMoss',         name: '젖은 이끼',                kind: '재료', cat: 'veg',   price:    0, sell: false, heal: 3,          desc: '스튜로 끓여 먹으면 그런대로 먹을만 하다.' },
  { key: 'dandelion',       name: '민들레',                   kind: '재료', cat: 'veg',   price:    1, sell: true,  heal: 2,          desc: '평범한 민들레. 하지만 누군가는 특별한 무언가를 느낄 수 있을지도 모른다. 잎과 뿌리는 모두 식용 가능.' },
  { key: 'earthworm',       name: '꿈틀지렁이',               kind: '재료', cat: 'meat',  price:    1, sell: true,  heal: 1,          monster: true, desc: '꿈틀거리며 생명력을 자랑한다. 미끼로 쓸 수 있으려나.' },
  { key: 'bitterHerb',      name: '고고초',                   kind: '재료', cat: 'spice', price:    2, sell: true,  heal: 5,          desc: '이름답게 매우, 매우 쓴 풀. 먹으면 나쁜 기운이 빠져나가는 느낌이 든다.' },
  { key: 'tearCrystal',     name: '눈물 결정',                kind: '잡화', price:    5, sell: true,  heal: 0,          desc: '눈 요정이 남긴 반짝거리는 결정 조각. 피부에 닿으면 무척 차갑다. 열 식히기에 딱!' },
  { key: 'crackleStone',    name: '파삭돌',                   kind: '잡화', price:    1, sell: true,  heal: 2,          desc: '돌을 문지르면 파삭거리는 소리와 함께 작은 스파크가 튄다. 신기하게 따갑진 않다.' },
  { key: 'oreBlue',         name: '푸른 원석',                kind: '잡화', price:   20, sell: true,  heal: -10,        desc: '세공되기 전 상태인 원석. 갈고 닦아지지 않아 큰 가치는 없지만, 푸른 빛에서 바다 내음이 느껴지는 듯 하다.' },
  { key: 'oreRed',          name: '붉은 원석',                kind: '잡화', price:   20, sell: true,  heal: -10,        desc: '세공되기 전 상태인 원석. 갈고 닦아지지 않아 큰 가치는 없지만, 붉은 빛이 타오르는 화염보다 강렬하다.' },
  { key: 'oreGold',         name: '금빛 원석',                kind: '잡화', price:   20, sell: true,  heal: -10,        desc: '세공되기 전 상태인 원석. 갈고 닦아지지 않아 큰 가치는 없지만, 금화에 견줄 만큼 선명한 노란빛이 감돈다.' },
  { key: 'oreGreen',        name: '녹빛 원석',                kind: '잡화', price:   20, sell: true,  heal: -10,        desc: '세공되기 전 상태인 원석. 갈고 닦아지지 않아 큰 가치는 없지만, 녹음 진 숲을 연상시키는 녹빛이 신비스럽다.' },
  { key: 'oreBlack',        name: '까만 원석',                kind: '잡화', price:   20, sell: true,  heal: -10,        desc: '햇빛을 전부 잡아먹을 것만 같은 원석. 기분이 묘할 정도로 새까만 탓에 어둠을 원석으로 만든 느낌이다.' },
  { key: 'oreWhite',        name: '하얀 원석',                kind: '잡화', price:   20, sell: true,  heal: 10,         desc: '햇빛에 예쁘게 반짝이는 원석. 핥으면 짠 맛이 난다.' },
  { key: 'oddFossil',       name: '정체 모를 화석',           kind: '잡화', price:  100, sell: true,  heal: -100,       desc: '세월을 가늠하기 힘들 정도로 오래되어 보이는 화석. 무엇이 화석으로 변한 걸까...? 뼈의 형태 같기도 하고.' },
  { key: 'driedMushroom',   name: '마른 버섯',                kind: '재료', cat: 'veg',   price:    2, sell: true,  heal: 5,          desc: '말라붙은 작은 버섯. 끓이면 먹을 수 있을 것 같지만... 이게 안전한 버섯일까?' },
  { key: 'brokenArrowhead', name: '부러진 화살촉',            kind: '잡화', price:    2, sell: true,  heal: 0,          desc: '튼튼하지만 이미 사용할 수 없는 화살촉. 갈아서 단검처럼 사용할 수도 있다.' },
  { key: 'starShard',       name: '희미한 별 조각',           kind: '잡화', price:   30, sell: false, heal: -10,        desc: '어두운 곳에서 은은하게 빛나는 작은 돌 조각. 마법 재료일 수도 있다.' },
  { key: 'ironLump',        name: '묵직한 철 덩어리',         kind: '잡화', price:   10, sell: true,  heal: 0,          desc: '대장장이가 원하는 재료일지도? 그냥은 좀 더 무거운 돌덩이와 다름 없다.' },
  { key: 'glowingStone',    name: '붉게 빛나는 돌 조각',      kind: '잡화', price:   15, sell: true,  heal: 5,          desc: '손에 쥐면 약간 따뜻한 느낌이 드는 돌 조각.' },
  { key: 'boneChip',        name: '작은 뼛조각',              kind: '잡화', price:    3, sell: true,  heal: 3,          desc: '희미한 무늬가 새겨진 작은 뼛조각. 동물의 것 같지만 정확히는 알 수 없다.' },
  { key: 'whiteShell',      name: '하얀 조개껍데기',          kind: '잡화', price:    5, sell: true,  heal: 0,          desc: '부드럽고 매끈한 하얀 조개껍데기. 귀에 대면 바다 소리가 들릴 것 같다.' },
  { key: 'brokenBracelet',  name: '끊어진 팔찌',              kind: '잡화', price:    3, sell: true,  heal: 0,          desc: '낡고 끊어진 은 팔찌. 수리하면 다시 사용할 수 있을 것 같다.' },
  { key: 'softFig',         name: '무른 무화과',              kind: '재료', cat: 'veg',   price:    1, sell: true,  heal: 2,          desc: '땅에 떨어진 지 오래되었는지 과육이 흐물거리고 단향이 진동한다. 아직 먹을 수 있다.' },
  { key: 'spicyBerry',      name: '맵싹한 열매',              kind: '재료', cat: 'spice', price:    3, sell: true,  heal: 10,         desc: '새빨간 열매. 매운 향기가 멀리서부터 진동해온다! 눈물을 쏙 빼놓기에 딱인 열매.' },
  { key: 'fallenBread',     name: '떨어져 있던 빵',           kind: '재료', cat: 'grain', price:    0, sell: false, heal: 2,          desc: '축축하면서도 동시에 딱딱하다. 완벽한 조화.' },
  { key: 'silverCoin',      name: '은화',                     kind: '잡화', price:    5, sell: true,  heal: -5,         desc: '앗, 골드! ...가 아니고 실버. 상점에서 5 골드로 바꿀 수 있다.' },
  { key: 'copperCoin',      name: '동화',                     kind: '잡화', price:    1, sell: true,  heal: -10,        desc: '앗, 골드! ...가 아니고 코퍼. 상점에서 1 골드로 바꿀 수 있다.' },
  { key: 'rabbitFoot',      name: '토끼발',                   kind: '잡화', price:   10, sell: true,  heal: -20,        desc: '다행스럽게도, 그저 모양 장식이다. 행운을 가져다줄지도?' },
  { key: 'wishbone',        name: '위시본(창사골)',           kind: '잡화', price:    1, sell: true,  heal: 1,          desc: 'Y자 모양의 작은 새 가슴뼈. 점을 칠 수 있다. 아니면 낚시 도구로 쓰든가!' },
  { key: 'wrinkledSausage', name: '쪼글쪼글한 소시지',        kind: '재료', cat: 'meat',  price:    0, sell: false, heal: 5,          desc: '속재료를 알 수 없는 소시지. ...궁금해하지 않는 편이 좋을 것 같다.' },
  { key: 'crystalPendulum', name: '수정 펜듈럼',              kind: '잡화', price:   40, sell: true,  heal: -10,        desc: '큰 수정이 박힌 펜듈럼. ...눈 모양의 수정이라 그런가? 우릴 쳐다보는 느낌이 든다.' },
  { key: 'brokenWatch',     name: '고장난 회중시계',          kind: '잡화', price:    5, sell: true,  heal: 0,          desc: '이게 웬 횡재! ...아, 시계침 소리가 들리지 않는다. 고장난 것 같다.' },
  { key: 'leatherScrap',    name: '가죽 조각',                kind: '잡화', price:    5, sell: true,  heal: 5,          desc: '부드러운 가죽 조각. 무언가를 만들 수 있을지도? 끓이면 말랑해져 먹을 수도 있다.' },
  { key: 'silverChain',     name: '은줄',                     kind: '잡화', price:   10, sell: true,  heal: 0,          desc: '흠집이 있지만 잘 세공된 가느다란 은줄이다. 이걸 더하면... 나도 멋쟁이?' },
  { key: 'handkerchief',    name: '손수건',                   kind: '잡화', price:    0, sell: false, heal: 1,          desc: '부드러운 손수건. 끄트머리엔 평생을 사랑해, 달링... 이라고 적혀있다. 써도 되는 걸까...?' },
  { key: 'crackleCandy',    name: '파삭캔디',                 kind: '재료', cat: 'sweet', price:    1, sell: true,  heal: 15,         desc: '파삭돌의 성분으로 만든 캔디. 입 안에 넣으면 파삭거리는 소리와 함께 캔디가 타닥타닥 녹는다.' },
  { key: 'brokenHilt',      name: '부러진 검 손잡이',         kind: '잡화', price:    3, sell: true,  heal: 0,          desc: '검의 날은 부러지고 손잡이만 남았다. 하지만 손에 쥐면 이상하게 익숙한 감각이 든다.' },
  { key: 'catWhisker',      name: '고양이 수염',              kind: '잡화', price:    8, sell: true,  heal: -5,         desc: '고양이의 수염 한 가닥. 행운을 부른다고 한다. 마법 재료로도 쓸 수 있을지도?' },
  { key: 'mapPiece',        name: '낡은 지도 조각',           kind: '잡화', price:    0, sell: false, heal: 0,          desc: '누군가의 보물 지도의 일부인 듯하다. 전부 모으면 무언가 찾을 수 있을지도?' },
  { key: 'woodenDoll',      name: '나무 인형',                kind: '잡화', price:    7, sell: true,  heal: -10,        desc: '정교하게 깎인 작은 나무 인형. 어린아이가 잃어버린 것 같지만, 누군가의 부적일 수도 있다.' },
  { key: 'cheapPendant',    name: '싸구려 펜던트',            kind: '잡화', price:    2, sell: true,  heal: 0,          desc: '이거, 설마 금?! ...아니다. 칠이 벗겨진 부분이 드러난다. 모조품인 모양이다.' },
  { key: 'hardenedCandle',  name: '굳어버린 밀랍초',          kind: '잡화', price:    6, sell: true,  heal: -10,        desc: '오래된 밀랍초. 불을 붙이면 약한 꿀향이 난다. 다 녹지는 않아 다시 불을 켤 수 있을 것 같다.' },
  { key: 'silverPendant',   name: '은 펜던트',                kind: '잡화', price:   30, sell: true,  heal: 0,          desc: '착용하지 않은 채 오랜 세월이 지난 탓인지, 검게 변색되었다.' },
  { key: 'portraitPendant', name: '누군가의 초상화가 담긴 펜던트',kind: '잡화', price:    0, sell: false, heal: 0,          desc: '빛이 바랜 누군가의 초상화가 안에 자리잡고 있는, 주인 모를 펜던트. 상점에 내놓기에는 마음이 좋지 않다.' },
  { key: 'glassMarble',     name: '작은 유리구슬',            kind: '잡화', price:    3, sell: true,  heal: 0,          desc: '빛에 따라 색이 변하는 작은 유리구슬. 마법적인 힘이 있을지도 모른다.' },
  { key: 'lastSipBottle',   name: '한 모금 남은 술병',        kind: '재료', cat: 'spice', price:    4, sell: true,  heal: 1,          desc: '무엇인지 모를 술이 한 모금 남아 있다. 용기가 있다면 마셔보기를!' },
  { key: 'potteryShard',    name: '깨진 도자기 조각',         kind: '잡화', price:    0, sell: false, heal: 0,          desc: '아름다운 문양이 남아 있는 깨진 도자기 조각. 원래의 형태를 알 수 없다.' },
  { key: 'fadedRibbon',     name: '빛바랜 리본',              kind: '잡화', price:    4, sell: false, heal: 0,          desc: '시간이 지나 색이 바랜 리본. 하지만 여전히 단단하게 묶을 수 있다.' },
  { key: 'oddIncense',      name: '묘한 향의 향초',           kind: '잡화', price:    7, sell: true,  heal: -5,         desc: '불을 붙이면 기분이 편안해지는 향이 난다. 하지만 효과는 미묘하다.' },
  { key: 'driedRose',       name: '마른 장미꽃',              kind: '잡화', price:    0, sell: false, heal: 0,          desc: '시들었지만 형태가 유지된 장미꽃. 누군가의 선물이었을지도 모른다.' },
  { key: 'brokenComb',      name: '부러진 나무빗',            kind: '잡화', price:    0, sell: false, heal: 0,          desc: '반쪽이 깨진 나무빗. 그래도 사용은 가능하다.' },
  { key: 'travelerMap',     name: '여행자의 지도',            kind: '잡화', price:    5, sell: true,  heal: 0,          desc: '종이가 바래어 일부가 보이지 않지만, 마을 근처의 지형이 대충 그려져 있다.' },
  { key: 'driedMeat',       name: '말린 고기 조각',           kind: '재료', cat: 'meat',  price:    3, sell: true,  heal: 10,         desc: '짭짤한 향이 도는 말린 고기. 씹을수록 감칠맛이 살아난다.' },
  { key: 'honeyWalnut',     name: '꿀절임 호두',              kind: '재료', cat: 'sweet', price:    4, sell: true,  heal: 5,          desc: '달콤한 꿀에 절인 호두. 한 입 베어물면 고소한 향이 퍼진다.' },
  { key: 'teaLeaf',         name: '찻잎',                     kind: '재료', cat: 'spice', price:    6, sell: true,  heal: 5,          desc: '향긋한 찻잎. 따뜻한 물에 우려내면 피로를 풀어준다.' },
  { key: 'banditPoster',    name: '도적단의 수배지',          kind: '잡화', price:    0, sell: false, heal: -5,         loot: false, desc: '이걸 왜 가지고 싶었는진 잘 모르겠다. 팔 수도 없다.' },
  { key: 'scratchedGem',    name: '흠집난 빨간 보석',         kind: '잡화', price:   30, sell: true,  heal: 0,          desc: '원석을 가공한 것. 다만 험하게 다뤘는지, 흠집이 나 가치가 떨어졌다.' },
  { key: 'bugPile',         name: '벌레 더미',                kind: '재료', cat: 'meat',  price:    0, sell: false, heal: 3,          monster: true, desc: '우글우글. 매우 많은 벌레입니다.' },
  { key: 'blueMist',        name: '푸른 안개',                kind: '잡화', price:   40, sell: true,  heal: 0,          loot: false, desc: '수면 및 마취 효과가 있는 안개. 부작용으론... 조금 멍청해진다.' },
  { key: 'prisonKey',       name: '감옥 열쇠',                kind: '잡화', price:    0, sell: false, heal: -10,        loot: false, desc: '두꺼운 철제 열쇠.' },
  { key: 'lizardEye',       name: '도마뱀 눈',                kind: '재료', cat: 'meat',  price:    2, sell: true,  heal: 8,          monster: true, desc: '금방이라도 살아 움직일 것 같은 도마뱀의 눈.' },
  { key: 'voidLump',        name: '공허 덩어리',              kind: '잡화', price:   15, sell: false, heal: -100,       desc: '순수한 어둠으로 이루어진 물컹한 덩어리.' },
  { key: 'redApple',        name: '새빨간 사과',              kind: '재료', cat: 'veg',   price:    5, sell: true,  heal: 10,         desc: '마녀의 집에서 주운, 새빨간 사과. ...진짜 사과일까?' },
  { key: 'ruby',            name: '루비',                     kind: '잡화', price:  200, sell: true,  heal: 0,          loot: false, desc: '붉은 원석을 가공한, 아름다운 보석. ...어째서인지 루비가 되었다.' },
  { key: 'sapphire',        name: '사파이어',                 kind: '잡화', price:  180, sell: true,  heal: 0,          loot: false, desc: '푸른 원석을 가공한, 새파란 보석.' },
  { key: 'garnet',          name: '가넷',                     kind: '잡화', price:  100, sell: true,  heal: 0,          loot: false, desc: '붉은 원석을 가공한, 빨갛게 빛나는 예쁜 보석.' },
  { key: 'emerald',         name: '에메랄드',                 kind: '잡화', price:  150, sell: true,  heal: 0,          loot: false, desc: '녹빛 원석을 가공한, 초록 빛깔의 보석.' },
  { key: 'onyx',            name: '오닉스',                   kind: '잡화', price:  100, sell: true,  heal: 0,          loot: false, desc: '까만 원석을 가공한, 빛을 흡수하는 새까만 보석.' },
  { key: 'topaz',           name: '토파즈',                   kind: '잡화', price:  150, sell: true,  heal: 0,          loot: false, desc: '금빛 원석을 가공한, 노란 빛의 보석.' },
  { key: 'salt',            name: '소금',                     kind: '재료', cat: 'spice', price:   10, sell: true,  heal: 15,         desc: '암염을 깎은 소금 덩어리.' },
  { key: 'fancyWatch',      name: '장식 회중시계',            kind: '잡화', price:   30, sell: true,  heal: 0,          desc: '그냥 조금 더 치렁치렁해진 회중시계.' },
  { key: 'bungeeTicket',    name: '번지점프 티켓',            kind: '잡화', price:   20, sell: true,  heal: 0,          loot: false, desc: '가지고 있으면 단장이 번지점프를 시켜줍니다.' },
  { key: 'sinew',           name: '심줄',                     kind: '잡화', price:    0, sell: false, heal: 100,        loot: false, desc: '단장 주머니에서 쌔빈 것.' },
  { key: 'dragonBlood',     name: '드래곤의 피',              kind: '잡화', price:    0, sell: false, heal: 50,         loot: false, desc: '아는 드래곤의 피입니다.' },
  { key: 'braveMeat',       name: '용맹한 고기',              kind: '재료', cat: 'meat',  price:   10, sell: true,  heal: 20,         desc: '사냥으로 얻은 용맹함의 고기! 질깁니다.' },
  { key: 'adventureToken',  name: '모험의 증표',              kind: '잡화', price:    0, sell: false, heal: 50,         loot: false, desc: '당신이야말로 진정한 모험가! 10장 모으면 선물이 있을지도 모른다.' },
  { key: 'vampireBlood',    name: '흡혈귀의 피',              kind: '잡화', price:    0, sell: false, heal: -50,        loot: false, desc: '아는 흡혈귀의 피입니다.' },
  { key: 'humElfBlood',     name: '훔-엘프의 피',             kind: '잡화', price:    0, sell: false, heal: 5,          loot: false, desc: '아는 훔의 피입니다. 어라? 조금 엘프가 섞인 것 같은데요.' },
  { key: 'bobSponge',       name: '밥르퐁지',                 kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: -10,        monster: true, desc: '해면을 닮았지만, 이건 말을 할 수 있다. 무슨 말을 하는 지 알고 싶다면 귀를 대 보자.' },
  { key: 'starGari',        name: '별가리',                   kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: -10,        monster: true, desc: '불가사리와 닮았지만, 이건 말을 할 수 있다. 무슨 말을 하는 지 알고 싶으면 귀를 대 보자.' },
  { key: 'waterCentipede',  name: '물지네',                   kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: -50,        poison: 2, monster: true, desc: '수십 개의 다리로 헤엄친다. 지네의 친척. 독이 있다.' },
  { key: 'hollowEye',       name: '할로우아이',               kind: '재료', cat: 'meat',  price:    1, sell: true,  heal: 15,         monster: true, desc: '살이 다 녹아 없어진, 뼈만 남은 물고기.' },
  { key: 'hardJaw',         name: '단단턱',                   kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: -10,        desc: '이빨이 날카로워 줄이 끊어질 뻔했다.' },
  { key: 'clearFish',       name: '투명물고기',               kind: '재료', cat: 'meat',  price:    3, sell: true,  heal: 0,          desc: '투명한 물고기. 관상용으로는 아주 좋다.' },
  { key: 'minnow',          name: '피라미',                   kind: '재료', cat: 'meat',  price:    1, sell: true,  heal: 1,          desc: '아아... 실망스럽다.' },
  { key: 'peacockFish',     name: '공작어',                   kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: 20,         desc: '공작의 꼬리처럼 수백 개의 눈을 가진 물고기. 모두 한 곳을 쳐다본다.' },
  { key: 'waveTail',        name: '파도꼬리',                 kind: '재료', cat: 'meat',  price:   10, sell: true,  heal: 10,         desc: '꼬리 힘이 대단하여 바다에서는 이것 10마리로 파도를 만들 수 있다는 것 같다.' },
  { key: 'catfish',         name: '메기',                     kind: '재료', cat: 'meat',  price:    3, sell: true,  heal: 5,          desc: '수염이 있다.' },

  // ---- 낚시로 올라오는 것들(`/요트 낚시`). 길이와 뽑기 가중치는 casino/fish.js 가 따로 안다.
  { key: 'chipFish',        name: '칩붕어',                   kind: '재료', cat: 'meat',  price:   25, sell: true,  heal: 5,          desc: '비늘이 칩처럼 동그랗고 납작하다. bard 에서 흘러간 것이 여기까지 왔다.' },
  { key: 'glassMinnow',     name: '유리 송사리',              kind: '재료', cat: 'meat',  price:    2, sell: true,  heal: 1,          desc: '물에 넣으면 어디 갔는지 못 찾는다.' },
  { key: 'stoneSucker',     name: '돌붙이',                   kind: '재료', cat: 'meat',  price:    4, sell: true,  heal: 3,          desc: '돌에 붙어 산다. 떼어 내면 돌이 따라온다.' },
  { key: 'bigEyeCarp',      name: '왕눈 잉어',                kind: '재료', cat: 'meat',  price:   12, sell: true,  heal: 10,         desc: '눈이 몸의 절반이다. 무엇을 그렇게 보고 있나.' },
  { key: 'moonSweetfish',   name: '달빛 은어',                kind: '재료', cat: 'meat',  price:   18, sell: true,  heal: 15,         desc: '밤에만 은빛이 돈다. 낮에는 그냥 물고기다.' },
  { key: 'rainbowTrout',    name: '무지개 송어',              kind: '재료', cat: 'meat',  price:   20, sell: true,  heal: 15,         desc: '비늘이 볼 때마다 다른 색이다.' },
  { key: 'sawPiranha',      name: '톱니 피라냐',              kind: '재료', cat: 'meat',  price:   22, sell: true,  heal: -20,        desc: '물 밖에서도 이를 간다. 손가락을 세지 말고 던져 넣자.' },
  { key: 'lanternAngler',   name: '등불 아귀',                kind: '재료', cat: 'meat',  price:   26, sell: true,  heal: 20,         desc: '이마의 등불로 먹이를 부른다. 건져 올려도 불은 안 꺼진다.' },
  { key: 'starRay',         name: '별무늬 가오리',            kind: '재료', cat: 'meat',  price:   30, sell: true,  heal: 25,         desc: '등에 밤하늘이 있다. 별자리는 매번 다르다.' },
  { key: 'toothClam',       name: '이빨 조개',                kind: '재료', cat: 'meat',  price:    8, sell: true,  heal: -10,        monster: true, desc: '열면 이가 가득하다. 닫을 때도 조심해야 한다.' },
  { key: 'inkSquid',        name: '먹물 오징어',              kind: '재료', cat: 'meat',  price:   14, sell: true,  heal: 12,         desc: '건져 올리면 먼저 먹물부터 뿌린다. 옷은 포기하자.' },
  { key: 'threeLegOctopus', name: '세 발 문어',               kind: '재료', cat: 'meat',  price:   22, sell: true,  heal: 18,         desc: '다리가 셋뿐이다. 나머지 다섯은 어디에 두고 왔을까.' },
  { key: 'hermitCrab',      name: '참집게',                   kind: '재료', cat: 'meat',  price:    8, sell: true,  heal: 5,          desc: '남의 집을 쓴다. 더 좋은 껍데기를 보면 미련 없이 이사한다.' },
  { key: 'oneArmCrab',      name: '외팔 집게',                kind: '재료', cat: 'meat',  price:   16, sell: true,  heal: 12,         desc: '집게발 한쪽만 크다. 그쪽으로만 인사한다.' },
  { key: 'spiralConch',     name: '나선 소라',                kind: '재료', cat: 'meat',  price:   10, sell: true,  heal: 8,          desc: '귀에 대면 파도 소리가 난다. 여기는 강인데.' },

  // ---- 전설 물고기. **던전에서는 안 나온다**(loot: false) — 낚시로만 만난다.
  { key: 'goldChipShark',   name: '황금 칩상어',              kind: '재료', cat: 'meat',  price:  500, sell: true,  heal: 40,         loot: false, desc: '스무 해 전, 빚에 쫓기던 노름꾼이 bard 의 뒷문으로 나가 강가에 앉았다. 주머니에 남은 마지막 칩 한 장을 미끼 삼아 던졌더니, 물속에서 칩 무리가 헤엄쳐 오더란다. 그는 그날 이후 카지노에 나타나지 않았고, 강에는 비늘이 전부 금빛 칩인 상어가 산다는 말만 남았다. 한 장만 떼어도 하이 자리에 앉는다고 한다. 떼어 본 사람은 아직 없다.' },
  { key: 'abyssLantern',    name: '심연의 등불',              kind: '재료', cat: 'meat',  price:  420, sell: true,  heal: 40,         loot: false, desc: '안개가 짙던 밤, 늙은 어부가 물밑에서 올라오는 등불을 보았다. 마중 나온 배인 줄 알고 노를 저어 갔더니 불빛은 자꾸 뒤로 물러났고, 정신을 차렸을 때 그는 강 한복판에 있었다. 사흘 뒤 빈 배만 돌아왔다. 그때부터 뱃사람들은 물속의 불빛을 보면 노를 반대로 저으라고 가르친다. 등불은 아귀의 이마에 달려 있고, 아귀는 백 년을 산다.' },
  { key: 'centuryCarp',     name: '백년 잉어',                kind: '재료', cat: 'meat',  price:  400, sell: true,  heal: 50,         loot: false, desc: '강가 마을에서 제일 오래 산 노인이 어릴 적에도 잡으려다 놓쳤고, 노인이 죽던 해에 손자도 놓쳤다. 비늘마다 나이테가 있어 세어 보면 나이를 알 수 있다는데, 세다가 백을 넘기면 손이 떨려 놓친다는 말이 있다. 이 잉어를 낚은 사람은 강물이 기억하는 만큼 오래 산다고 한다.' },
  { key: 'lordOfWater',     name: '물의 주인',                kind: '재료', cat: 'meat',  price:  500, sell: true,  heal: 50,         loot: false, desc: '가뭄이 들면 마을 사람들이 강에 소를 바쳤다. 물이 한 번 크게 숨을 쉬면 이튿날 비가 왔고, 숨을 쉬지 않으면 그해는 아무도 물가에 가지 않았다. 지금은 아무도 소를 바치지 않지만, 강 한가운데가 이유 없이 부풀어 오르는 날이 있다. 그런 날 낚싯대를 드리운 사람은 셋인데, 돌아온 사람은 하나다. 그 하나는 아무 말도 하지 않았다.' },
  { key: 'wreckGhostFish',  name: '난파선의 유령어',          kind: '재료', cat: 'meat',  price:  450, sell: true,  heal: 30,         loot: false, desc: '요트 한 척이 강 어귀에서 뒤집힌 적이 있다. 배는 끝내 못 찾았고, 그 자리에서 낚시하던 이들이 창백한 물고기를 보았다고 했다. 비늘 사이에 배에서 떨어져 나온 나뭇조각이 끼어 있고, 건져 올리면 물 대신 뱃밥 냄새가 난다. 뱃사람들은 이 물고기를 잡으면 그 배가 어디 가라앉았는지 알게 된다고 믿는다.' },

  // ---- 낚시에 걸려 올라오는 잡동사니
  { key: 'soggyBoot',       name: '물먹은 장화',              kind: '잡화', price:    2, sell: true,  heal: -2,         desc: '한 짝뿐이다. 나머지 한 짝은 아직 물속에 있다.' },
  { key: 'wetRope',         name: '젖은 밧줄 토막',           kind: '잡화', price:    3, sell: true,  heal: 0,          desc: '매듭이 단단하다. 무엇을 묶어 두었던 걸까.' },
  { key: 'soakedBook',      name: '불어 터진 책',             kind: '잡화', price:    1, sell: true,  heal: 0,          desc: '글자가 다 번졌다. 딱 한 줄만 읽힌다 — "물가에서는".' },
  { key: 'rustyHook',       name: '녹슨 낚싯바늘',            kind: '잡화', price:    4, sell: true,  heal: -5,         desc: '누군가 놓친 것이다. 그 사람도 여기 앉아 있었다.' },

  // ---------------------------------------------------------------- 재료
  { key: 'wheat',           name: '밀 이삭',                  kind: '재료', cat: 'grain', price:    2, sell: true,  heal: 1,   shop: true,               desc: '빻으면 가루, 안 빻으면 그냥 풀. 모험단은 주로 후자를 씹는다.' },
  { key: 'flour',           name: '밀가루',                   kind: '재료', cat: 'grain', price:    5, sell: true,  heal: -2,  shop: true,  loot: false, desc: '한 줌 집어 먹으면 목이 막힌다. 반죽이 되기를 기다리는 가루.' },
  { key: 'oats',            name: '귀리',                     kind: '재료', cat: 'grain', price:    3, sell: true,  heal: 3,   shop: true,               desc: '말에게 주던 것을 사람이 먹기 시작했다. 노숙 사흘째의 표준 아침.' },
  { key: 'barley',          name: '보리',                     kind: '재료', cat: 'grain', price:    3, sell: true,  heal: 2,   shop: true,               desc: '스튜를 걸쭉하게 하거나, 잘 말리면 맥주가 된다. 대개 후자를 노린다.' },
  { key: 'rice',            name: '쌀',                       kind: '재료', cat: 'grain', price:    6, sell: true,  heal: 1,   shop: true,  loot: false, desc: '먼 동쪽에서 온 곡식. 씻을 물이 귀한 노숙지에서는 사치다.' },
  { key: 'hardtack',        name: '모험가 건빵',              kind: '재료', cat: 'grain', price:    4, sell: true,  heal: 5,   shop: true,  loot: false, desc: '이로 깨물면 이가 진다. 물에 불리면 그럭저럭.' },
  { key: 'rawMeat',         name: '날고기',                   kind: '재료', cat: 'meat',  price:    5, sell: true,  heal: -5,                            desc: '마물 고기는 먼지가 되니, 이건 멀쩡한 짐승의 것이다. 굽기 전엔 먹지 말 것.' },
  { key: 'boarRib',         name: '멧돼지 갈비',              kind: '재료', cat: 'meat',  price:   15, sell: true,  heal: -3,                            desc: '통째로 구우면 모험단 전원이 먹는다. 날로 뜯으면 한 명이 앓는다.' },
  { key: 'chickenLeg',      name: '닭다리',                   kind: '재료', cat: 'meat',  price:    6, sell: true,  heal: -3,  shop: true,               desc: '어느 농가 닭의 것인지는 묻지 않기로 하자.' },
  { key: 'egg',             name: '달걀',                     kind: '재료', cat: 'meat',  price:    3, sell: true,  heal: 1,   shop: true,  loot: false, desc: '열 개를 사면 하나는 꼭 깨져 있다.' },
  { key: 'bacon',           name: '베이컨',                   kind: '재료', cat: 'meat',  price:    8, sell: true,  heal: 8,   shop: true,  loot: false, desc: '소금에 절여 훈연한 것. 이미 익어 있어서 날로 씹어도 괜찮다.' },
  { key: 'shrimp',          name: '민물새우',                 kind: '재료', cat: 'meat',  price:    6, sell: true,  heal: -2,                            desc: '튀기면 바삭, 날로 먹으면 배가 뒤틀린다.' },
  { key: 'seaweed',         name: '마른 해초',                kind: '재료', cat: 'meat',  price:    2, sell: true,  heal: 2,   shop: true,               desc: '바삭하게 부서진다. 국물을 내면 바다 맛이 난다.' },
  { key: 'potato',          name: '감자',                     kind: '재료', cat: 'veg',   price:    2, sell: true,  heal: -1,  shop: true,               desc: '싹 난 건 버리자. 스튜의 기둥.' },
  { key: 'carrot',          name: '당근',                     kind: '재료', cat: 'veg',   price:    2, sell: true,  heal: 3,   shop: true,               desc: '말이 좋아한다. 말은 없지만.' },
  { key: 'onion',           name: '양파',                     kind: '재료', cat: 'veg',   price:    2, sell: true,  heal: -2,  shop: true,               desc: '까다 보면 눈물이 나고, 날로 먹으면 입에서 난다.' },
  { key: 'garlic',          name: '마늘',                     kind: '재료', cat: 'veg',   price:    3, sell: true,  heal: 1,   shop: true,               desc: '마물은 몰라도 흡혈귀는 싫어한다고 한다.' },
  { key: 'cabbage',         name: '양배추',                   kind: '재료', cat: 'veg',   price:    3, sell: true,  heal: 3,   shop: true,  loot: false, desc: '한 통이면 일주일 간다. 일주일 내내 양배추다.' },
  { key: 'pumpkin',         name: '늙은 호박',                kind: '재료', cat: 'veg',   price:    8, sell: true,  heal: 2,   shop: true,               desc: '들고 다니기엔 무겁고 버리기엔 아깝다.' },
  { key: 'pineMushroom',    name: '향송이',                   kind: '재료', cat: 'veg',   price:   25, sell: true,  heal: 5,                             desc: '숲 깊은 곳에서만 난다. 이쁘니 버섯과 헷갈리지 말 것.' },
  { key: 'raspberry',       name: '산딸기',                   kind: '재료', cat: 'veg',   price:    2, sell: true,  heal: 5,                             desc: '베리 파수꾼단이 이름값 하는 순간.' },
  { key: 'blueberry',       name: '블루베리',                 kind: '재료', cat: 'veg',   price:    3, sell: true,  heal: 5,                             desc: '한 움큼 먹으면 혀가 보라색이 된다.' },
  { key: 'grape',           name: '포도',                     kind: '재료', cat: 'veg',   price:    4, sell: true,  heal: 5,   shop: true,  loot: false, desc: '먹어도 되고, 밟아도 된다. 밟으면 나중에 술이 된다.' },
  { key: 'lemon',           name: '레몬',                     kind: '재료', cat: 'veg',   price:    4, sell: true,  heal: 2,   shop: true,  loot: false, desc: '시다. 너무 시다. 생선에 뿌리면 비린내가 달아난다.' },
  { key: 'keeperBerry',     name: '파수꾼 베리',              kind: '재료', cat: 'veg',   price:   30, sell: true,  heal: 15,                            desc: '단원들만 아는 덤불에서 딴 베리. 알이 굵고, 단장이 제일 먼저 집어 간다.' },
  { key: 'milk',            name: '우유',                     kind: '재료', cat: 'sweet', price:    4, sell: true,  heal: 5,   shop: true,  loot: false, desc: '하루만 지나도 치즈 흉내를 낸다.' },
  { key: 'butter',          name: '버터',                     kind: '재료', cat: 'sweet', price:    8, sell: true,  heal: 3,   shop: true,  loot: false, desc: '뭘 굽든 버터를 넣으면 맛있어진다. 그게 규칙이다.' },
  { key: 'cheese',          name: '치즈 덩어리',              kind: '재료', cat: 'sweet', price:   10, sell: true,  heal: 10,  shop: true,               desc: '구멍은 쥐가 낸 것이다.' },
  { key: 'honey',           name: '꿀 한 병',                 kind: '재료', cat: 'sweet', price:   12, sell: true,  heal: 12,  shop: true,               desc: '벌집째 들고 오느라 손등이 부었다.' },
  { key: 'honeycomb',       name: '벌집 조각',                kind: '재료', cat: 'sweet', price:   15, sell: true,  heal: 8,                             desc: '밀랍 반, 꿀 반. 씹다 보면 밀랍만 남는다.' },
  { key: 'sugar',           name: '설탕',                     kind: '재료', cat: 'sweet', price:   15, sell: true,  heal: 5,   shop: true,  loot: false, desc: '릴레인과 연락이 끊긴 뒤로 값이 뛰었다.' },
  { key: 'pepper',          name: '통후추',                   kind: '재료', cat: 'spice', price:   25, sell: true,  heal: -3,  shop: true,  loot: false, desc: '한 알에 은화 한 닢이던 시절도 있었다. 지금이 그 시절이다.' },
  { key: 'cinnamon',        name: '계피',                     kind: '재료', cat: 'spice', price:   20, sell: true,  heal: 0,   shop: true,  loot: false, desc: '나무껍질인데 비싸다. 향이 모든 걸 설명한다.' },
  { key: 'saffron',         name: '사프란',                   kind: '재료', cat: 'spice', price:   60, sell: true,  heal: 0,   shop: true,  loot: false, desc: '꽃술 세 가닥. 금보다 비싸다는 소문이 있다.' },
  { key: 'bayLeaf',         name: '월계수 잎',                kind: '재료', cat: 'spice', price:    3, sell: true,  heal: 0,   shop: true,               desc: '스튜에 넣고, 꼭 빼는 걸 잊는다.' },
  { key: 'rosemary',        name: '로즈마리',                 kind: '재료', cat: 'spice', price:    3, sell: true,  heal: 1,                             desc: '고기 옆에 두면 고기가 고급이 된다.' },
  { key: 'mint',            name: '박하',                     kind: '재료', cat: 'spice', price:    3, sell: true,  heal: 3,                             desc: '씹으면 입안이 한겨울이 된다.' },
  { key: 'ginger',          name: '생강',                     kind: '재료', cat: 'spice', price:    4, sell: true,  heal: 4,   shop: true,               desc: '노숙한 다음 날 아침엔 이걸 끓인다.' },
  { key: 'oil',             name: '식용유',                   kind: '재료', cat: 'spice', price:   10, sell: true,  heal: -5,  shop: true,  loot: false, desc: '병째 마실 생각은 하지 말자.' },
  { key: 'vinegar',         name: '식초',                     kind: '재료', cat: 'spice', price:    5, sell: true,  heal: -3,  shop: true,  loot: false, desc: '포도주가 되다 만 것. 절임에 쓴다.' },
  { key: 'cheapWine',       name: '싸구려 포도주',            kind: '재료', cat: 'spice', price:    8, sell: true,  heal: 2,   shop: true,  loot: false, desc: '요리에 넣으면 그럴듯하고, 마시면 그럴듯하지 않다.' },
  { key: 'spirits',         name: '독한 증류주',              kind: '재료', cat: 'spice', price:   20, sell: true,  heal: -10, shop: true,  loot: false, desc: '마시면 목이 타고, 지네를 담그면 지네가 운다.' },
  // 독 — 전부 던전에서만 난다. 요리에 넣으면 먹을 때까지 모른다
  { key: 'sproutPotato',    name: '눈 뜬 감자',               kind: '재료', cat: 'veg',   price:    1, sell: true,  heal: -8,  poison: 1,              desc: '싹이 눈처럼 삐죽 올라왔다. 눈을 마주치면 뭔가 할 말이 있어 보인다.' },
  { key: 'flyAgaric',       name: '빨간 점박이버섯',          kind: '재료', cat: 'veg',   price:    8, sell: true,  heal: -30, poison: 2,              desc: '빨간 갓에 하얀 점박이. 동화책에서 본 것 같은 모양이다. 먹으면 동화 속에 들어간 기분이 든다던데.' },
  { key: 'belladonna',      name: '까망 반들열매',            kind: '재료', cat: 'veg',   price:    6, sell: true,  heal: -25, poison: 2,              desc: '까맣고 반들반들한 열매. 달큰한 향이 코끝을 간지럽힌다. 이상하게 새들은 이걸 안 쪼아 먹는다.' },
  { key: 'thornApple',      name: '가시방울 씨',              kind: '재료', cat: 'spice', price:    5, sell: true,  heal: -25, poison: 2,              desc: '가시투성이 방울 속에 든 작은 씨앗. 볶으면 고소한 냄새가 난다고 한다.' },
  { key: 'deathCap',        name: '하얀 우산버섯',            kind: '재료', cat: 'veg',   price:   12, sell: true,  heal: -70, poison: 3,              desc: '매끈한 하얀 갓의 버섯. 너무 평범하게 생겨서 오히려 눈에 안 띈다.' },
  { key: 'hemlock',         name: '물가 미나리',              kind: '재료', cat: 'veg',   price:    6, sell: true,  heal: -60, poison: 3,              desc: '물가에서 뜯은 미나리. 줄기에 보랏빛 점이 있다. 원래 이랬던가?' },
  { key: 'wolfsbane',       name: '보라투구 뿌리',            kind: '재료', cat: 'spice', price:   10, sell: true,  heal: -60, poison: 3,              desc: '보랏빛 투구 모양 꽃의 뿌리. 늑대들은 이 근처에 얼씬도 안 한다고 한다.' },
  { key: 'puffer',          name: '빵빵어',                   kind: '재료', cat: 'meat',  price:   20, sell: true,  heal: -80, poison: 3,              desc: '건드리면 공처럼 부푼다. 살이 쫄깃하고 달다는 소문이 있다. 소문의 뒷부분은 아무도 모른다.' },
  // 괴식 — 마물에게서 나온 것. 전부 던전에서만 난다. 잘 요리하면 「던전밥」
  { key: 'slimeJelly',      name: '말랑젤리',                 kind: '재료', cat: 'sweet', price:    6, sell: true,  heal: 6,              monster: true, desc: '쓰러진 슬라임에서 떼어 낸 말랑한 조각. 먼지가 되기 전에 떼어 내면 한동안 탱글하다. 은근히 달다.' },
  { key: 'monsterDust',     name: '반짝이 가루',              kind: '재료', cat: 'spice', price:    8, sell: true,  heal: -5,  poison: 1, monster: true, desc: '마물이 쓰러지며 남긴 반짝이는 먼지 한 줌. 짭조름하다는 사람도, 혀가 저리다는 사람도 있다.' },
  { key: 'tentacle',        name: '흐물촉수',                 kind: '재료', cat: 'meat',  price:   10, sell: true,  heal: -10,            monster: true, desc: '아직도 꿈틀거리는 촉수 토막. 날로는 질기지만 잘 익히면 쫄깃하다는 소문이다.' },
  { key: 'bigEgg',          name: '얼룩덜룩한 알',            kind: '재료', cat: 'meat',  price:   12, sell: true,  heal: 3,              monster: true, desc: '둥지도 없이 굴러다니던 커다란 알. 흔들면 안에서 뭔가 톡톡 친다.' },
  { key: 'batWing',         name: '박쥐 날개',                kind: '재료', cat: 'meat',  price:    4, sell: true,  heal: -3,             monster: true, desc: '얇고 질긴 날개막. 바삭하게 구우면 과자 같다고 한다.' },
  { key: 'squishPouch',     name: '말랑 주머니',              kind: '재료', cat: 'spice', price:   15, sell: true,  heal: -40, poison: 2, monster: true, desc: '마물 몸속에 있던 작은 주머니. 누르면 톡 쏘는 향이 올라온다. 향신료로 쓴다는 사람이 있다.' },
  { key: 'scaleFlake',      name: '비늘 부스러기',            kind: '재료', cat: 'spice', price:    5, sell: true,  heal: 0,              monster: true, desc: '먼지가 되지 않고 남은 단단한 비늘 조각. 갈면 은빛 가루가 된다.' },
  { key: 'spiderLeg',       name: '털북숭이 다리',            kind: '재료', cat: 'meat',  price:    9, sell: true,  heal: -6,             monster: true, desc: '털이 숭숭 난 기다란 다리. 속살은 게살 맛이 난다는데 확인한 사람은 드물다.' },
  { key: 'screamRoot',      name: '비명 뿌리',                kind: '재료', cat: 'veg',   price:   14, sell: true,  heal: [-12, 12], poison: 1, monster: true, desc: '뽑을 때 작은 비명을 지르는 뿌리. 먹으면 기운이 난다는 말도, 그 반대라는 말도 있다.' },
  { key: 'walkingCap',      name: '도망가는 버섯갓',          kind: '재료', cat: 'veg',   price:    8, sell: true,  heal: 5,              monster: true, desc: '제 발로 도망치던 버섯의 갓. 잡고 나니 얌전하다. 아직 조금 따뜻하다.' },
];

export const ITEM_BY_KEY = Object.fromEntries(ITEMS.map((i) => [i.key, i]));

/** 상점에 나오는 것. 값이 0 인 물건은 살 수도 팔 수도 없다. */
export const forSale = () => ITEMS.filter((i) => i.price > 0);

/** 그 아이템을 먹었을 때의 증감. `[a, b]` 면 그 사이에서 뽑는다. */
export function healOf(item, rand = Math.random) {
  const h = item?.heal ?? 0;
  if (!Array.isArray(h)) return h;
  const [lo, hi] = h;
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** 이름으로 찾기. 사람이 친 것을 받을 때 쓴다 — 공백은 무시한다. */
const NORMAL = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const BY_NAME = new Map(ITEMS.map((i) => [NORMAL(i.name), i]));
export const findItem = (text) => ITEM_BY_KEY[text] ?? BY_NAME.get(NORMAL(text)) ?? null;

export default { MAX_HP, ITEMS, ITEM_BY_KEY, forSale, healOf, findItem };
