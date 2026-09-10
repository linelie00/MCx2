/**
 * /급여 — 미겔·마티암에게 일당을 준다
 *
 * 두 사람은 **자동으로 골드가 늘지 않는다.** 한동안 판을 열 때 하루 한 번 자동으로
 * 채웠는데, 그러면 시간이 지나서 생긴 돈이 된다. 일해서 번 돈이라는 설정에는
 * **누가 줘야** 맞다. 그래서 자동 충전을 걷어내고 이 명령을 뒀다.
 *
 * 부를 때마다 `WAGE` 만큼 는다. 하루 한 번 같은 제한이 없다 — 얼마나 일했는지는
 * 사람이 정하는 것이라 규칙으로 묶을 게 없다. 그 대신 **누가 언제 줬는지 채널에
 * 남는다**(공개 응답). 그게 사실상의 기록이다.
 *
 * 사람은 이걸 못 받는다. 사람 몫은 `/출첵` 이고 그쪽은 하루 한 번 규칙이 붙는다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { postAccountDeltas } from '../api.js';
import { base, fail } from '../embeds.js';
import { NPC_CHOICES, displayOf, characterOf } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';

/** 한 번 부를 때 주는 골드. */
export const WAGE = 1000;

const data = new SlashCommandBuilder()
  .setName('급여')
  .setDescription('미겔·마티암에게 일당을 줍니다.')
  .addStringOption((o) => o.setName('캐릭터').setDescription('누구에게 줄지')
    .setRequired(true)
    .addChoices(...NPC_CHOICES))
  .addIntegerOption((o) => o.setName('배수').setDescription(`며칠치인지 (기본 1 = ${WAGE}골드)`)
    .setMinValue(1).setMaxValue(10));

async function execute(interaction) {
  const id = interaction.options.getString('캐릭터');
  if (!characterOf(id)) {
    await interaction.reply({ embeds: [fail('미겔·마티암에게만 줄 수 있어요.')] });
    return;
  }

  const days = interaction.options.getInteger('배수') ?? 1;
  const amount = WAGE * days;

  // 서버 왕복이라 3초를 넘길 수 있다. 먼저 응답을 잡아 둔다.
  await interaction.deferReply();

  const who = displayOf(id);
  let gold;
  try {
    const res = await postAccountDeltas({ [id]: amount });
    gold = res.accounts[id].gold;
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`일당을 주지 못했어요. ${err.message}`)] });
    return;
  }

  // 판에 앉아 있으면 그 판의 스택은 안 바뀐다 — 골드는 정산 전까지 인메모리 장부에만
  // 있다. 물어보기 전에 미리 말해 둔다(`/출첵` 과 같은 이유).
  const seated = seatedAt(id);
  const note = seated
    ? `\n\n_지금 <#${seated.channelId}> 의 ${seated.game} 판에 앉아 있어요 —_`
      + ' _그 판에 들고 간 골드는 그대로고, 받은 몫은 판이 끝난 뒤에 합쳐져요._'
    : '';

  await interaction.editReply({
    embeds: [base({
      title: `${who.name} · ${gold}골드`,
      description: `${days > 1 ? `${days}일치 ` : ''}일당 **${amount}골드**를 받았어요.${note}`,
      color: who.color,
      footer: '부를 때마다 받습니다 — 얼마나 일했는지는 사람이 정해요',
    })],
  });
}

export default { data, execute };
