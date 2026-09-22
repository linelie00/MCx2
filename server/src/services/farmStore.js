/**
 * farmStore — farms.json 읽기/쓰기
 *
 * 채널 농장. shape: { farms: { "<channelId>": farm }, cooldowns: { "<userId>": "YYYY-MM-DD" } }
 * farm 의 모양은 `farm/rules.js` 머리말에 있다.
 *
 * `accountStore` 와 **같은 규약**이다. 이 파일도 유일본이기 때문이다(시드가 없다).
 *   1. 파싱에 실패하면 던진다. 반쪽 난 파일을 "농장 없음" 으로 읽고 그 위에 쓰면 전부 날아간다.
 *   2. `.tmp` 에 쓰고 `renameSync` 한다.
 *   3. read → 수정 → write 사이에 `await` 을 넣지 않는다.
 *
 * 계정(accounts.json)과 **파일을 나눈다.** 대신 둘에 걸친 요청(심기·수확)은 컨트롤러가
 * 셈을 다 끝낸 뒤 "잃을 수는 있어도 복제되지는 않는" 순서로 두 번 쓴다(farmController 머리말).
 * 사람이 고칠 때 **주인은 `farms[*].owner` 에만 있다** — 주인별 색인을 따로 두지 않는다.
 * 두 곳에 적으면 언젠가 어긋난다.
 */
const fs = require('fs');
const path = require('path');
const { LIVE_DIR } = require('../config/paths');

const FILE = path.join(LIVE_DIR, 'farms.json');
const TMP = `${FILE}.tmp`;

function read() {
  // 파일이 없는 것은 손상이 아니다 — 아직 아무도 등록 안 한 것뿐이다.
  if (!fs.existsSync(FILE)) return { farms: {}, cooldowns: {} };

  const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
  if (!data || typeof data.farms !== 'object' || data.farms === null) {
    throw new Error('farms.json 의 모양이 아닙니다 (farms 객체가 없음)');
  }
  return { farms: data.farms, cooldowns: data.cooldowns ?? {} };
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(TMP, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(TMP, FILE);
}

module.exports = { read, write, FILE };
