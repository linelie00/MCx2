/**
 * farm/news — 출첵 때 읽어 주는 마을 소식
 *
 * 오늘·내일 날씨와 달력(계절이 바뀌는 날, 행사)을 한 상자에 담는다. 날씨는 모든 농장이
 * 같아서(`/농장 날씨`) 누가 눌러도 같은 소식이다.
 *
 * 상자는 코드 블록이다. 머리와 꼬리의 음표 줄은 라디오에서 노래가 흘러나오는 흉내다.
 */
import { SKY_NOTE } from './ui/weather.js';

const OPEN = '♬·*¨*•.¸¸♪ 오늘의 마을 소식 ♪¸¸.•*¨*·♬';
const CLOSE = '✧ ♪¸¸.•*¨*•♬ 이상, 마을 소식이었어요 ♬•*¨*•.¸¸♪ ✧';

/**
 * 달력의 행사. 아직 없다 — 품평회·축제 같은 것이 들어오면 여기에 적는다.
 * `on(day, season)` 이 참인 날 `text` 를 알린다. `day` 는 KST `YYYY-MM-DD`,
 * `season` 은 `{ key, name, emoji, day }`(그 계절의 몇째 날).
 *   예) { on: (_, s) => s.day === 1, text: (s) => `${s.emoji} ${s.name} 맞이 축제가 열려요` }
 */
const EVENTS = [];

/** 계절 한 줄 — 몇째 날인지, 다음 계절까지 며칠인지. `ahead` 는 오늘부터 앞날의 날씨·계절. */
function seasonLine(season, ahead) {
  const at = ahead.findIndex((a) => a.season.key !== season.key);
  const next = at > 0 ? ahead[at].season : null;
  const head = `${season.emoji} ${season.name} ${season.day}일째`;
  if (!next) return head;
  if (at === 1) return `${head} — 내일부터 ${next.emoji} ${next.name}이에요`;
  return `${head} — ${next.name}까지 ${at}일`;
}

/**
 * 소식 상자(코드 블록 문자열). `wf` 는 `getWeather(14)` 의 응답.
 */
export function newsBox(wf) {
  const t = wf.today; const n = wf.tomorrow;
  const ahead = wf.ahead ?? [];
  const events = EVENTS
    .filter((e) => e.on(wf.day, t.season))
    .map((e) => `📜 ${typeof e.text === 'function' ? e.text(t.season) : e.text}`);
  const lines = [
    OPEN,
    '',
    `오늘 ${t.weather.emoji} ${t.weather.name} — ${SKY_NOTE[t.weather.key]}`,
    `내일 ${n.weather.emoji} ${n.weather.name} — ${SKY_NOTE[n.weather.key]}`,
    '',
    seasonLine(t.season, ahead),
    ...events,
    '',
    CLOSE,
  ];
  return ['```', ...lines, '```'].join('\n');
}
