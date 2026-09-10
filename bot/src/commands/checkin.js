/**
 * /출첵 — 하루 한 번 골드를 받는다
 *
 * 골드가 영구 저장이 되면서 생긴 명령이다. 안 그러면 파산한 사람이 **영영** 못 논다.
 *
 * 규칙은 하나뿐이다 — **하루 한 번, 1000 미만이면 1000으로.** 미겔·마티암이 판을 열
 * 때 자동으로 받는 것과 같은 규칙이고, 서버의 `dailyRule` 한 곳에만 적혀 있다.
 *
 * **판정은 서버가 한다.** 봇이 재시작해도 잊으면 안 되고, 날짜가 잔액과 같은 파일에
 * 있어야 한 번의 쓰기로 끝난다. 하루의 경계는 한국 날짜다.
 *
 * 넉넉해서 못 받은 날은 **도장을 안 찍는다.** 1200 가진 사람이 눌러도 그냥 넘어가고,
 * 그날 파산하면 그때 받을 수 있다. "하루 한 번 시도" 가 아니라 "하루 한 번, 진짜로
 * 모자랐을 때" 다.
 *
 * 판에 앉아 있어도 쓸 수 있다. 양도와 달리 안전하다 — 일일 규칙은 계정을 덮어쓰고,
 * 판의 증감은 정산 시점 잔액 위에 얹히기 때문이다. 300으로 앉아 출첵으로 1000이 되고
 * 300을 잃으면 700, 맞다. 다만 지금 앉은 판의 스택은 안 바뀌므로 그렇다고 적어 준다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { claimDaily } from '../api.js';
import { base, fail } from '../embeds.js';
import { displayOf } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';

const data = new SlashCommandBuilder()
  .setName('출첵')
  .setDescription('하루 한 번, 골드가 모자라면 채워 받습니다.');

async function execute(interaction) {
  // 서버 왕복이라 3초를 넘길 수 있다. 먼저 응답을 잡아 둔다.
  await interaction.deferReply();

  const me = displayOf(interaction.user.id, {
    user: interaction.user, member: interaction.member,
  });

  let res;
  try {
    res = await claimDaily(interaction.user.id);
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`골드를 받지 못했어요. ${err.message}`)] });
    return;
  }

  const seated = seatedAt(interaction.user.id);
  const note = seated
    ? `\n\n_지금 <#${seated.channelId}> 의 ${seated.game} 판에 앉아 있어요 —_`
      + ' _그 판에 들고 간 골드는 그대로고, 받은 몫은 판이 끝난 뒤에 합쳐져요._'
    : '';

  if (res.refilled) {
    await interaction.editReply({
      embeds: [base({
        title: `${res.gold}골드`,
        description: `${me.name}님, 오늘 몫이에요. **${res.before}골드 → ${res.gold}골드**${note}`,
        color: me.color,
        footer: '내일 또 오세요 (한국 시간 0시 기준)',
      })],
    });
    return;
  }

  // 못 받은 것도 오류가 아니다. 사유가 둘이고, 뜻이 서로 다르다.
  const body = res.reason === 'enough'
    ? `${me.name}님은 아직 **${res.gold}골드**나 있어요. ${res.floor}골드 아래로 내려가면 그때 채워 드릴게요.`
      + '\n_오늘 몫은 아직 안 쓴 거예요._'
    : `오늘 몫은 이미 받으셨어요. 지금 **${res.gold}골드**고, 다음은 한국 시간 0시에요.`;

  await interaction.editReply({
    embeds: [base({ title: '출첵', description: body + note, color: me.color })],
  });
}

export default {
  // 골드를 받는 것뿐이다. 이걸 막으면 파산한 채로 죽은 사람이 영영 못 일어난다
  allowDead: true, data, execute };
