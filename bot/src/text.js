/**
 * text — 고정폭 표를 위한 폭 맞추기
 *
 * 한글은 고정폭 글꼴에서 라틴 문자의 두 배를 차지한다. 그냥 padEnd 를 쓰면 이름이 한글인
 * 열에서 표가 어긋난다. 요트 점수표를 만들며 필요했고, 블랙잭 골드 표도 같은 게 필요하다.
 *
 * 공용 embeds.js 가 아니라 따로 두는 이유는 embeds.js 가 디스코드 임베드를 다루는
 * 모듈이기 때문이다. 이건 그냥 글자 계산이라 디스코드를 몰라도 된다.
 */

/**
 * 이 코드포인트가 두 칸을 차지하는지.
 * 한글·한자·가나·전각 기호 범위다. 유니코드 East Asian Width 표의 W/F 를 굵게 추린 것으로,
 * 우리가 쓰는 글자(한글·숫자·영문·괄호)에는 충분하다.
 */
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf)
  || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
  || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
  || (cp >= 0xffe0 && cp <= 0xffe6);

/** 보이는 폭. 한글은 2, 나머지는 1로 센다. */
export function width(text) {
  let w = 0;
  for (const ch of String(text)) w += isWide(ch.codePointAt(0)) ? 2 : 1;
  return w;
}

/** 보이는 폭 기준으로 자른다. 글자 중간에서 끊지 않는다. */
export function clipW(text, n) {
  let out = '';
  let w = 0;
  for (const ch of String(text)) {
    const cw = isWide(ch.codePointAt(0)) ? 2 : 1;
    if (w + cw > n) break;
    out += ch;
    w += cw;
  }
  return out;
}

export const padEndW = (text, n) => `${text}${' '.repeat(Math.max(0, n - width(text)))}`;
export const padStartW = (text, n) => `${' '.repeat(Math.max(0, n - width(text)))}${text}`;

export default { width, clipW, padEndW, padStartW };
