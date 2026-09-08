/**
 * embeds — 공통 임베드 헬퍼
 *
 * 디스코드 한도: title 256 / description 4096 / footer 2048 / 메시지당 임베드 10개 / 합계 6000자.
 * 대사 데이터에 2000자를 넘는 줄이 있어서(최장 2044자) 자르는 처리를 한곳에 모아 둔다.
 */
import { EmbedBuilder } from 'discord.js';

/** 사이트 테마의 기본 색. 캐릭터 색은 owners.OWNER_META 쪽을 쓴다. */
export const THEME_COLOR = 0x8a7a5c;

/** n자를 넘으면 잘라내고 말줄임을 붙인다. */
export function trunc(text, n) {
  const s = String(text ?? '');
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function base({ title, description, color = THEME_COLOR, footer } = {}) {
  const e = new EmbedBuilder().setColor(color);
  if (title) e.setTitle(trunc(title, 256));
  if (description) e.setDescription(trunc(description, 4096));
  if (footer) e.setFooter({ text: trunc(footer, 2048) });
  return e;
}

/** 실패를 알릴 때. 사용자에게는 항상 한국어 한 줄로 보여준다. */
export function fail(message) {
  return base({ title: '안 됐어요', description: message, color: 0x9c5a4a });
}

export default { THEME_COLOR, trunc, base, fail };
