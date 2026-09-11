/**
 * /출첵 — 하루 한 번 골드와 체력을 받는다
 *
 * 골드가 영구 저장이 되면서 생긴 명령이다. 안 그러면 파산한 사람이 **영영** 못 논다.
 *
 * 규칙은 둘이고 도장도 따로다.
 *   골드  **1000 미만이면 1000으로**(서버 `dailyRule`)
 *   체력  **다쳤으면 20 회복**, 최대치에서 멈춘다(서버 `healRule`). 쓰러진 사람은
 *         안 일어난다 — 부활은 부활의 영약으로만
 *
 * 미겔·마티암은 출첵을 안 한다. 체력은 **날이 바뀌면 서버가 저절로** 20 올려 주고
 * (`npcDaily`), 골드는 `/급여` 로만 는다.
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
 *
 * **던전만은 체력을 건너뛴다.** 던전은 체력을 걸고 있어서, 여기서 고치면 다음 핸드의
 * 쓰기에 섞여 들어가 "던전 안에서는 회복 못 한다" 가 뚫린다. 건너뛴 날은 도장이 안
 * 찍히므로 나와서 다시 누르면 받는다.
 */
import { SlashCommandBuilder } from 'discord.js';
import { claimDaily } from '../api.js';
import { base, fail } from '../embeds.js';
import { displayOf } from '../casino/accounts.js';
import { seatedAt } from '../casino/tables.js';
import { forget } from '../casino/alive.js';

const data = new SlashCommandBuilder()
  .setName('출첵')
  .setDescription('하루 한 번, 골드가 모자라면 채우고 체력을 20 회복합니다.');

async function execute(interaction) {
  // 서버 왕복이라 3초를 넘길 수 있다. 먼저 응답을 잡아 둔다.
  await interaction.deferReply();

  const me = displayOf(interaction.user.id, {
    user: interaction.user, member: interaction.member,
  });

  // 판에 앉아 있는지 **먼저** 본다. 던전이면 체력을 건너뛰라고 서버에 알려야 한다.
  const seated = seatedAt(interaction.user.id);
  const inDungeon = seated?.mode === 'dungeon';

  let res;
  try {
    res = await claimDaily(interaction.user.id, { heal: !inDungeon });
  } catch (err) {
    await interaction.editReply({ embeds: [fail(`출첵을 하지 못했어요. ${err.message}`)] });
    return;
  }

  const lines = [goldLine(res, me), hpLine(res.heal, me)];
  if (seated) {
    lines.push('', inDungeon
      ? `_지금 <#${seated.channelId}> 던전에 있어요 — 체력은 나와서 다시 누르면 받아요. 오늘 몫은 그대로 남아 있어요._`
      : `_지금 <#${seated.channelId}> 의 ${seated.game} 판에 앉아 있어요 —_`
        + ' _그 판에 들고 간 골드는 그대로고, 받은 몫은 판이 끝난 뒤에 합쳐져요._');
  }

  const got = res.refilled || res.heal?.healed;
  await interaction.editReply({
    embeds: [base({
      title: got ? `${me.name}님, 오늘 몫이에요` : '출첵',
      description: lines.join('\n'),
      color: me.color,
      footer: '내일 또 오세요 (한국 시간 0시 기준)',
    })],
  });
  // 체력이 바뀌었을 수 있다. 사망 캐시를 비워 다음 명령이 서버를 다시 보게 한다.
  forget(interaction.user.id);
}

/** 골드 한 줄. 못 받은 것도 오류가 아니다 — 사유가 둘이고 뜻이 서로 다르다. */
function goldLine(res, me) {
  if (res.refilled) return `💰 **${res.before}골드 → ${res.gold}골드**`;
  if (res.reason === 'enough') {
    return `💰 아직 **${res.gold}골드**나 있어요. ${res.floor}골드 아래로 내려가면 그때 채워 드릴게요.`
      + ' _오늘 몫은 아직 안 쓴 거예요._';
  }
  return `💰 골드는 오늘 이미 받았어요. 지금 **${res.gold}골드**.`;
}

/** 체력 한 줄. 옛 서버(체력을 모르는)면 아무 말도 안 한다. */
function hpLine(heal, me) {
  if (!heal) return '';
  const max = heal.max ?? 100;
  if (heal.healed) return `❤️ 체력 **${heal.before} → ${heal.hp}** / ${max}`;
  switch (heal.reason) {
    case 'full': return `❤️ 체력은 가득이에요(**${heal.hp}**). 다치면 그때 오늘 몫을 받을 수 있어요.`;
    case 'dead': return `💀 ${me.name}님은 쓰러져 있어서 체력은 못 받아요 — **부활의 영약**으로 일어난 뒤에 다시 누르면 받아요.`;
    case 'skipped': return `❤️ 체력은 지금 **${heal.hp}** — 던전 안이라 오늘 몫은 남겨 뒀어요.`;
    default: return `❤️ 체력은 오늘 이미 받았어요. 지금 **${heal.hp}** / ${max}.`;
  }
}

export default {
  // 골드를 받아야 부활의 영약을 산다. 이걸 막으면 파산한 채로 죽은 사람이 영영 못 일어난다
  allowDead: true, data, execute };
