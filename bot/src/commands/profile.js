/**
 * /프로필 — 칭호 · 이름 · 칩 · 아이템
 *
 * 카지노 계정을 사람이 볼 수 있는 유일한 창이다. 대상을 안 주면 자기 것.
 *
 * **칭호와 아이템은 아직 늘 비어 있다.** 채우는 것은 `/상점`·`/요리`·`/아이템 양도` 가
 * 생길 때다. 틀만 먼저 뚫어 두는 이유는 계정 레코드가 이미 그 필드를 들고 있고,
 * 그때 가서 화면을 새로 짜는 것보다 지금 자리를 잡아 두는 편이 낫기 때문이다.
 *
 * 대상을 옵션 둘로 받는다 — 사람은 유저 옵션, 미겔·마티암은 선택지. 하나로 못 합친다:
 * 길드 멤버를 자동완성으로 뒤지려면 GuildMembers 인텐트가 필요한데 봇은 Guilds 만 켠다.
 *
 * 응답은 **공개**다. 서로 칩을 견주는 재미가 이 명령의 절반이다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { getAccounts } from '../api.js';
import { base, fail } from '../embeds.js';
import { NPC_CHOICES, resolveTarget } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';

const data = new SlashCommandBuilder()
  .setName('프로필')
  .setDescription('칭호와 칩, 아이템을 봅니다.')
  .addUserOption((o) => o.setName('사람').setDescription('기본값은 본인'))
  .addStringOption((o) => o.setName('캐릭터').setDescription('미겔·마티암의 지갑')
    .addChoices(...NPC_CHOICES));

/** 아이템 `{ id: 개수 }` 를 한 줄로. 아직 아무도 아무것도 안 가지고 있다. */
function itemLines(items) {
  const rows = Object.entries(items ?? {}).filter(([, n]) => n > 0);
  if (!rows.length) return '_아직 없어요._';
  return rows.map(([id, n]) => `${id} × ${n}`).join(' · ');
}

async function execute(interaction) {
  const who = resolveTarget(interaction);
  if (who.error) {
    await interaction.reply({ embeds: [fail(who.error)] });
    return;
  }

  // 계정 조회는 HTTP 다. 카지노 명령 중 **인터랙션 경로 안에서** 서버를 부르는 첫 명령이라
  // (판은 전부 드라이버에서 불렀다) 3초 시한을 먼저 잡아 둔다.
  await interaction.deferReply();

  let account;
  try {
    const res = await getAccounts([who.id]);
    account = res.accounts[who.id];
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`계정을 읽지 못했어요. ${err.message}`)] });
    return;
  }

  const seated = seatedAt(who.id);
  const lines = [
    `**칭호** ${account.title ?? '_없음_'}`,
    `**칩** ${account.chips}`,
    `**아이템** ${itemLines(account.items)}`,
  ];

  // 판에 앉아 있으면 잔액이 "지금 그 판까지 반영된 값" 이 아니다 — 정산 전까지는
  // 칩이 판의 장부 안에만 있다. 물어보기 전에 미리 말해 둔다.
  if (seated) {
    lines.push('', `_지금 <#${seated.channelId}> 의 ${seated.game} 판에 앉아 있어요._`
      + ' _판이 끝나야 이 숫자에 반영돼요._');
  }

  await interaction.editReply({
    embeds: [base({
      title: who.name,
      description: lines.join('\n'),
      color: who.color,
      footer: who.npc ? '판을 열 때 하루 한 번 채워집니다' : '/출첵 으로 하루 한 번 받을 수 있어요',
    })],
  });
}

export default { data, execute };
