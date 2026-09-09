/**
 * accountStore — accounts.json 읽기/쓰기
 *
 * 카지노 계정. 칩과, 나중에 붙을 칭호·아이템이 여기 산다.
 * shape: { accounts: { "<id>": { chips, title, items, refilledAt, updatedAt } } }
 * `<id>` 는 디스코드 유저 id, 또는 `npc:migel` / `npc:matiam`.
 *
 * 다른 스토어(movieStore·playlistStore)와 **두 곳이 다르다.** 둘 다 이 파일이
 * **유일본**이기 때문이다 — 영화·플리는 시드가 받쳐 주지만 칩은 잃으면 끝이다.
 *
 *   1. 파싱에 실패하면 **던진다.** 다른 스토어는 빈 컬렉션을 돌려준다. 그렇게 하면
 *      반쪽 난 파일이 "전원 잔액 0" 으로 조용히 읽히고, 그 위에 한 번만 더 쓰면
 *      진짜로 0이 된다. 차라리 503 을 내고 사람이 알아채는 편이 낫다.
 *   2. 쓰기는 `.tmp` 에 하고 `renameSync` 한다. 같은 파일시스템 안의 rename 은
 *      원자적이라, 쓰다가 프로세스가 죽어도 반쪽 파일이 자리를 차지하지 않는다.
 *
 * 그리고 read → 수정 → write 사이에 **`await` 을 넣지 않는다.** 락이 없는 대신
 * 노드가 단일 스레드인 것에 기대는 구조라, 중간에 양보하면 갱신이 유실된다.
 */
const fs = require('fs');
const path = require('path');
const { LIVE_DIR } = require('../config/paths');

const FILE = path.join(LIVE_DIR, 'accounts.json');
const TMP = `${FILE}.tmp`;
const SEED = path.join(__dirname, '../data/accounts.seed.json');

function read() {
  if (!fs.existsSync(FILE)) {
    // 최초 실행. 시드가 있으면 복사하고, 없으면 빈 장부로 시작한다.
    // **파일이 없는 것은 손상이 아니다** — 아직 아무도 안 논 것뿐이다.
    if (fs.existsSync(SEED)) {
      try {
        fs.copyFileSync(SEED, FILE);
      } catch (e) {
        return { accounts: {} };
      }
    } else {
      return { accounts: {} };
    }
  }

  // 여기서부터는 파일이 있다. 못 읽으면 **손상**이므로 던진다.
  const raw = fs.readFileSync(FILE, 'utf-8');
  const data = JSON.parse(raw);
  if (!data || typeof data.accounts !== 'object' || data.accounts === null) {
    throw new Error('accounts.json 의 모양이 아닙니다 (accounts 객체가 없음)');
  }
  return { accounts: data.accounts };
}

function write(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(TMP, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(TMP, FILE);
}

module.exports = { read, write, FILE };
