/**
 * requireOwner — 쓰기 권한 보호 미들웨어
 * 헤더 X-Owner-Key 가 .env의 오너 키 중 하나와 일치하면 통과하고 req.owner를 채운다.
 * 일치하지 않으면 401. (읽기 엔드포인트에는 적용하지 않는다.)
 */
function ownerForKey(key) {
  if (!key) return null;
  if (process.env.OWNER_MATIAM_KEY && key === process.env.OWNER_MATIAM_KEY) return 'matiam';
  if (process.env.OWNER_MIGEL_KEY && key === process.env.OWNER_MIGEL_KEY) return 'migel';
  return null;
}

function requireOwner(req, res, next) {
  const owner = ownerForKey(req.get('X-Owner-Key'));
  if (!owner) return res.status(401).json({ error: 'owner authorization required' });
  req.owner = owner;
  return next();
}

module.exports = { requireOwner, ownerForKey };
