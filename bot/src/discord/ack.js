/**
 * ack — 클릭을 접수한다. **실패해도 판은 계속 간다.**
 *
 * 디스코드는 인터랙션이 생긴 지 3초 안에 응답을 안 하면 그것을 **없애 버린다**
 * (10062 Unknown interaction). 그 뒤로는 어떤 방법으로도 답할 수 없다.
 *
 * 문제는 그 다음이다. 게임 명령은 대개 이렇게 생겼다.
 *
 *     const refused = await handler(...);   // 여기서 판이 이미 움직였다
 *     await interaction.deferUpdate();      // ← 여기서 10062 로 던지면
 *     await draw(game);                     //   이 둘이 통째로 안 돈다
 *     kick(game);
 *
 * 그래서 **수는 적용됐는데 화면은 안 바뀌고 드라이버도 안 돌아 판이 그 자리에서
 * 멈춘다.** 사람이 보기에는 봇이 죽은 것과 구분이 안 된다.
 *
 * 클릭 하나를 잃는 것은 어쩔 수 없다 — 이미 사라진 인터랙션이다. 하지만 **판까지
 * 같이 멈출 이유는 없다.** 여기서 10062 만 삼키고 `false` 를 돌려주면, 부르는 쪽은
 * 그리기와 드라이버를 그대로 이어간다. 다음 화면이 새로 그려지므로 사람은 버튼을
 * 다시 누를 수 있다.
 *
 * 10062 가 아닌 오류는 **그대로 올린다.** 권한 문제 같은 것을 여기서 삼키면 원인을
 * 찾을 길이 없어진다.
 */

/** 이미 접수했으면 다시 안 한다(두 번 하면 40060 으로 던진다). */
export async function ack(interaction, where = '') {
  if (interaction.deferred || interaction.replied) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (err) {
    if (err?.code !== 10062) throw err;
    console.warn(`[${where || '봇'}] 클릭이 3초 시한을 넘겨 사라졌어요 — 판은 그대로 이어갑니다.`);
    return false;
  }
}

/**
 * 사라진 인터랙션에 대고 말하려다 나는 오류를 삼킨다.
 *
 * 거절 문구는 **알려 주는 것뿐**이라, 못 보냈다고 그 위의 흐름까지 끊을 이유가 없다.
 */
export const quiet = (p) => p.catch((err) => {
  if (err?.code !== 10062 && err?.code !== 40060) throw err;
  return null;
});

export default { ack, quiet };
