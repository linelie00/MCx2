/**
 * controls — 재생 중 메시지에 붙는 버튼
 *
 * 곡을 넘기려고 매번 /플리 건너뛰기 를 치는 건 번거롭다. 재생 알림에 버튼을 달아두면
 * 한 번 누르는 것으로 끝난다.
 *
 * customId 는 "plq:동작" 형태로 통일해 index.js 가 한 곳에서 라우팅한다.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  skip, pause, resume, isPaused, leave, shuffle, getState,
} from './player.js';

export const PREFIX = 'plq:';

const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(PREFIX + id).setLabel(label).setStyle(style);

/** 재생 알림에 붙일 버튼 줄. 일시정지 상태에 따라 가운데 버튼이 바뀐다. */
export function controlRow(guildId) {
  const paused = isPaused(guildId);
  return new ActionRowBuilder().addComponents(
    button('skip', '건너뛰기'),
    paused ? button('resume', '다시재생', ButtonStyle.Success) : button('pause', '일시정지'),
    button('shuffle', '섞기'),
    button('queue', '대기열'),
    button('stop', '정지', ButtonStyle.Danger),
  );
}

/**
 * 버튼 하나를 처리한다.
 * 결과는 { text, refresh } — refresh 가 true 면 호출부가 버튼 줄을 새로 그린다.
 */
export function handle(action, guildId) {
  const s = getState(guildId);
  if (!s) return { text: '지금 아무것도 안 틀고 있어요.' };

  switch (action) {
    case 'skip': {
      const t = skip(guildId);
      return { text: t ? `**${t.title}** 을(를) 넘겼어요.` : '넘길 곡이 없어요.' };
    }
    case 'pause':
      return pause(guildId)
        ? { text: '일시정지했어요.', refresh: true }
        : { text: '멈출 곡이 없어요.' };
    case 'resume':
      return resume(guildId)
        ? { text: '다시 재생해요.', refresh: true }
        : { text: '멈춰 있지 않아요.' };
    case 'shuffle': {
      const n = shuffle(guildId);
      return { text: n ? `대기열 ${n}곡을 섞었어요.` : '섞을 곡이 없어요.' };
    }
    case 'queue': {
      if (!s.queue.length) return { text: '대기열이 비어 있어요.' };
      const list = s.queue.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`).join('\n');
      const more = s.queue.length > 10 ? `\n… 그 외 ${s.queue.length - 10}곡` : '';
      return { text: `\`\`\`\n${list}${more}\n\`\`\`` };
    }
    case 'stop':
      leave(guildId);
      return { text: '멈추고 나왔어요.' };
    default:
      return { text: '모르는 버튼이에요.' };
  }
}

export default { PREFIX, controlRow, handle };
