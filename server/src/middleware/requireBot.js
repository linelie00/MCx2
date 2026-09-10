/**
 * requireBot — 봇 전용 엔드포인트 보호
 *
 * 헤더 `X-Bot-Key` 가 `.env` 의 `BOT_KEY` 와 같으면 통과. 아니면 401.
 *
 * **`requireOwner` 를 쓰지 않는 이유.** 오너 패스코드는 사이트에서 사람이 직접
 * 입력하는 값이다. 계정 엔드포인트가 그걸 받으면 브라우저에서도 아무나 남의 골드를
 * 조작할 수 있게 된다. 골드는 봇만 만지므로 키도 봇만 갖는 게 맞다.
 *
 * `BOT_KEY` 가 비어 있으면 **전부 막는다.** 안 그러면 키를 안 넣은 배포에서
 * 계정 API 가 통째로 열린 채 돌아간다.
 */
function requireBot(req, res, next) {
  const expected = process.env.BOT_KEY;
  if (!expected) return res.status(401).json({ error: 'bot key not configured' });
  if (req.get('X-Bot-Key') !== expected) return res.status(401).json({ error: 'bot authorization required' });
  return next();
}

module.exports = { requireBot };
