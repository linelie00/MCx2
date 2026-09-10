/**
 * titleCard — 칭호를 화면에 내는 모양
 *
 * 두 곳이 같은 꾸밈을 쓴다. 판이 끝나고 뜨는 **획득 알림**과 `/프로필` 의 **칭호 탭**.
 * 별과 색이 두 곳에서 달라지면 같은 칭호로 안 보이므로 여기 한 군데서 만든다.
 *
 * **명패는 ansi 코드블록이다.** 디스코드가 ```ansi 를 색으로 렌더한다(모바일도 된다).
 * 판 임베드가 전부 양피지색 한 가지라, 금색 한 덩이가 들어가면 그것만으로 "이건
 * 다른 것" 이 읽힌다.
 *
 * **테두리를 사방으로 두르지 않는다.** 위아래 가로줄만 긋는다. `═`·`║` 같은 괘선
 * 문자는 East Asian Width 가 Ambiguous 라 글꼴에 따라 한 칸이 되기도 두 칸이 되기도
 * 하는데, 오른쪽 변까지 세우면 그 폭을 맞출 수가 없다(글자 폭은 아는데 괘선 폭을
 * 모른다). 위아래 줄만 있으면 서로 길이가 같으므로 어느 쪽이든 안 어긋난다.
 */
import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { trunc } from '../embeds.js';
import { tierOf, TOTAL } from './titles.js';

/** 명패 가로줄. 고정 길이다 — 글자 수에 맞추면 칭호마다 폭이 달라져 들쭉날쭉하다. */
const RULE = '━'.repeat(22);

const ESC = '\u001b';
const paint = (code, text) => `${ESC}[${code}m${text}${ESC}[0m`;

/**
 * 이름에 자간을 넣는다. `왕관` → `왕 관`
 *
 * 하나짜리 명패에만 쓴다. 새긴 것처럼 보이게 하는 값싼 수인데, 여럿을 늘어놓을 때
 * 쓰면 줄만 길어지고 읽기가 나빠진다.
 */
const spaced = (name) => [...name].join(' ');

/**
 * 명패 한 장. 받은 칭호들의 이름을 등급 색으로 새긴다.
 *
 * 하나면 크게 한 줄, 여럿이면 줄마다 하나씩. 색은 **칭호마다 제 등급**을 따른다 —
 * 금 하나와 동 하나를 같이 얻었을 때 둘 다 금으로 칠하면 거짓말이 된다.
 */
export function plaque(titles) {
  const one = titles.length === 1;
  const lines = titles.map((t) => {
    const tier = tierOf(t);
    const name = one ? spaced(t.name) : t.name;
    return `  ${paint(tier.ansi, `${tier.stars}  ${name}`)}`;
  });
  return ['```ansi', RULE, ...lines, RULE, '```'].join('\n');
}

/**
 * 푸터용 막대. `embeds.gauge` 와 달리 **백틱을 안 두른다** — 푸터는 마크다운을
 * 렌더하지 않아서 코드 표시를 넣으면 백틱이 글자 그대로 보인다.
 */
const bar = (done, total, cells = 10) => {
  const filled = Math.round(Math.max(0, Math.min(1, done / total)) * cells);
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
};

/**
 * `★★★ 왕관` — 이름표.
 *
 * 마크다운을 안 넣는다. 셀렉트 선택지와 임베드 author 는 마크다운을 렌더하지 않아서
 * 별표가 글자 그대로 보인다. 굵게 쓸 자리는 `stampMd` 를 쓴다.
 */
export const stamp = (t) => `${tierOf(t).stars} ${t.name}`;

/** `★★★ **왕관**` — 설명글 안에서. */
export const stampMd = (t) => `${tierOf(t).stars} **${t.name}**`;

/**
 * 획득 알림 임베드. `{ embeds, files }` 를 그대로 채널에 보내면 된다.
 *
 * 색은 **이번에 얻은 것 중 제일 높은 등급**을 따른다. 금색 띠가 아무 때나 뜨면
 * 금색이 아무 뜻도 없어진다.
 *
 * 얼굴은 사람이면 디스코드 CDN 주소, 미겔·마티암이면 로컬 파일이라 같이 올려야 한다.
 */
export function awardCard({ name, avatar, avatarFile, fresh, held }) {
  const top = fresh.reduce((a, t) => Math.max(a, t.tier ?? 1), 1);

  const embed = new EmbedBuilder()
    .setColor(tierOf({ tier: top }).color)
    .setAuthor({ name: `🏅 ${name} · 새 칭호` })
    .setDescription(plaque(fresh))
    .addFields(fresh.slice(0, 10).map((t) => ({
      name: trunc(`${stamp(t)} · ${t.group}`, 256),
      value: trunc(`_${t.desc}_\n-# 🔓 ${t.cond}`, 1024),
      inline: false,
    })))
    .setFooter({ text: `수집  ${bar(held, TOTAL)}  ${held} / ${TOTAL}` });

  if (avatar) embed.setThumbnail(avatar);

  // 미겔·마티암 얼굴은 로컬 파일이라 **메시지에 같이 올려야** 썸네일이 뜬다.
  return {
    embeds: [embed],
    files: avatarFile ? [new AttachmentBuilder(avatarFile.file, { name: avatarFile.name })] : [],
  };
}

export default { plaque, stamp, stampMd, awardCard };
