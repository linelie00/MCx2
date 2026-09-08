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

/**
 * 마크다운 특수문자를 이스케이프한다.
 *
 * 유튜브 영상 제목이나 사용자가 적은 값을 **굵게** 나 [링크](url) 안에 그대로 넣으면
 * 문법이 깨진다. 실제로 "[MV] 정우 - 낡은 괴담" 같은 제목이 있어서 링크가 망가졌다.
 * 우리가 만든 문구가 아니라 남에게서 온 문자열을 마크다운에 넣을 때 반드시 거친다.
 */
export function mdEscape(text) {
  return String(text ?? '').replace(/([\\*_~`|[\]])/g, '\\$1');
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

export default { THEME_COLOR, trunc, mdEscape, base, fail };
