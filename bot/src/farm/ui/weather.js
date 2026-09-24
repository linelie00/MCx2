/**
 * farm/ui/weather — 날씨 창 (4a)
 */
import { getFarmCrops, getWeather } from '../../api.js';
import { base } from '../../embeds.js';
import { FARM_COLOR } from '../render.js';
import { EPH, QUIET } from './shared.js';

/** 날씨 효과 한 줄(설명). 출첵의 소식(`farm/news.js`)도 쓴다. */
export const SKY_NOTE = {
  clear: '보통 날', cloudy: '성장 ×0.9', rain: '비가 물을 줘요(체력 안 듦)', downpour: '비가 물을 줘요 · 뿌리 작물 품질 −10',
  heat: '물 한 포기에 체력 2 · 용의 고추 ×2', frost: '제철이 아닌 작물이 상해요', storm: '키 큰 작물(옥수수·해바라기)이 쓰러져요',
  rainbow: '오늘 거두면 품질 +10',
};

/** `/농장 날씨` — 오늘·내일, 앞으로 이레, 오늘 제철인 작물. */
export function weatherPayload({ wf, crops }) {
  const t = wf.today; const n = wf.tomorrow;
  const week = (wf.ahead ?? []).map((a) => `${a.weather.emoji}`).join(' ');
  const inSeason = crops.filter((c) => wf.inSeason.includes(c.key) && !c.seedOnly);
  const lines = [
    `**오늘** ${t.weather.emoji} ${t.weather.name} — ${SKY_NOTE[t.weather.key]}`,
    `**내일** ${n.weather.emoji} ${n.weather.name} — ${SKY_NOTE[n.weather.key]}`,
    '',
    `${t.season.emoji} **${t.season.name}** ${t.season.day}일째 / 14 — 계절은 2주마다 바뀌어요`,
    week ? `앞으로 이레 ${week}` : null,
    '',
    `🗓️ **지금 제철** (${inSeason.length}종) — ${inSeason.map((c) => `${c.emoji}${c.name}`).join(' ')}`,
    '_제철이 아니면 성장 ×0.7 · 품질이 떨어져요_',
  ].filter((l) => l != null);
  return {
    embeds: [base({ title: `${t.weather.emoji} 오늘의 날씨`, description: lines.join('\n'), color: FARM_COLOR, footer: '모든 농장이 같은 날씨예요 · 날씨는 미리 정해져 있어요' })],
    allowedMentions: QUIET,
  };
}

export async function weatherCmd(interaction) {
  await interaction.deferReply({ flags: EPH });
  const [wf, crops] = await Promise.all([getWeather(7), getFarmCrops()]);
  return interaction.editReply(weatherPayload({ wf, crops }));
}
