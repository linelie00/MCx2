/**
 * 오너 패스코드 점검 — 손으로 돌리는 스크립트
 *
 *   cd bot && npm run check-keys
 *
 * .env 의 OWNER_MIGEL_KEY / OWNER_MATIAM_KEY 가 사이트 서버에서 실제로 통하는지
 * /api/auth/me 로, BOT_KEY 가 통하는지 /api/accounts 로 확인한다.
 * 봇을 띄우지 않고도 값만 빠르게 검증할 수 있다.
 *
 * 패스코드 자체는 절대 출력하지 않는다. 길이와 지문(해시 앞 8자)만 보여준다 —
 * 두 사람이 같은 값을 넣었는지, 값이 바뀌었는지 비교하기엔 그걸로 충분하다.
 */
import crypto from 'node:crypto';
import config from './src/config.js';
import { OWNERS, OWNER_META } from './src/owners.js';

const fingerprint = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 8);

console.log(`API 주소: ${config.api.base}\n`);

let allOk = true;

for (const owner of OWNERS) {
  const label = `${owner} (${OWNER_META[owner].label})`.padEnd(18);
  const raw = process.env[`OWNER_${owner.toUpperCase()}_KEY`] || '';
  const key = raw.trim();

  if (!key) {
    console.log(`${label} 값이 비어 있음`);
    allOk = false;
    continue;
  }

  const note = raw !== key ? '  ← 앞뒤에 공백/개행이 있습니다' : '';
  let verdict;

  try {
    const res = await fetch(`${config.api.base}/api/auth/me`, {
      headers: { 'X-Owner-Key': key },
    });
    if (!res.ok) {
      verdict = `거절 (${res.status}) ✖  서버의 OWNER_${owner.toUpperCase()}_KEY 와 다릅니다`;
      allOk = false;
    } else {
      const body = await res.json();
      if (body.owner === owner) {
        verdict = '통과 ✔';
      } else {
        verdict = `✖ 서버는 ${body.owner} 로 인식합니다 — 두 키가 뒤바뀐 것 같습니다`;
        allOk = false;
      }
    }
  } catch (err) {
    verdict = `연결 실패 — ${err.cause?.code || err.message}`;
    allOk = false;
  }

  console.log(`${label} 길이 ${String(key.length).padStart(3)} · 지문 ${fingerprint(key)} · ${verdict}${note}`);
}

// 봇 키는 오너 키와 쓰임이 다르다 — 이게 막히면 쓰기 하나가 아니라 **카지노 게임이
// 통째로 안 열린다**(잔액을 못 읽으면 판을 여는 것 자체가 거절이다). 같이 본다.
{
  const raw = process.env.BOT_KEY || '';
  const key = raw.trim();
  const label = '봇 키 (카지노)'.padEnd(18);

  if (!key) {
    console.log(`${label} 값이 비어 있음  ← 골드를 못 읽어 카지노 판이 안 열립니다`);
    allOk = false;
  } else {
    let verdict;
    try {
      const res = await fetch(`${config.api.base}/api/accounts?ids=npc:migel`, {
        headers: { 'X-Bot-Key': key },
      });
      if (res.ok) {
        verdict = '통과 ✔';
      } else {
        verdict = `거절 (${res.status}) ✖  서버의 BOT_KEY 와 다릅니다`;
        allOk = false;
      }
    } catch (err) {
      verdict = `연결 실패 — ${err.cause?.code || err.message}`;
      allOk = false;
    }
    const note = raw !== key ? '  ← 앞뒤에 공백/개행이 있습니다' : '';
    console.log(`${label} 길이 ${String(key.length).padStart(3)} · 지문 ${fingerprint(key)} · ${verdict}${note}`);
  }
}

console.log();
if (allOk) {
  console.log('키가 모두 정상입니다. 쓰기 명령과 카지노를 쓸 수 있습니다.');
} else {
  console.log('Railway 의 server 서비스 > Variables 에서 OWNER_*_KEY · BOT_KEY 값을 확인해 복사해 주세요.');
  console.log('사이트에서 로그아웃 후 그 값으로 로그인이 되는지 보면 확실합니다');
  console.log('(사이트는 localStorage 만 보고 로그인 상태를 표시해서, 값이 바뀌어도 로그인된 것처럼 보입니다).');
  process.exitCode = 1;
}
