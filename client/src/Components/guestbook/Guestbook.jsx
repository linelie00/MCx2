/**
 * Guestbook — Home 하단 방명록
 * 닉네임 + 코멘트 작성(공개), 지난 방명록 목록. 삭제는 오너만 보인다.
 */
import { useEffect, useState } from 'react';
import '../../Styles/Guestbook.css';
import * as guestbookApi from '../../services/guestbookApi';
import { useOwner } from '../../contexts/OwnerContext';

const NICK_MAX = 30;
const MSG_MAX = 500;

const formatDate = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
};

function Guestbook() {
  const [entries, setEntries] = useState([]);
  const [nick, setNick] = useState('');
  const [message, setMessage] = useState('');
  const [hp, setHp] = useState(''); // 허니팟(사람은 비워둠)
  const [challenge, setChallenge] = useState(null); // { id, question }
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { isOwner } = useOwner();

  const loadChallenge = () => {
    setAnswer('');
    guestbookApi.fetchChallenge().then(setChallenge).catch(() => setChallenge(null));
  };

  useEffect(() => {
    let alive = true;
    guestbookApi
      .fetchEntries()
      .then((list) => {
        if (alive) {
          setEntries(list);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    loadChallenge();
    return () => {
      alive = false;
    };
  }, []);

  const canSubmit = nick.trim() && message.trim() && answer.trim() && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const created = await guestbookApi.addEntry({
        nick: nick.trim(),
        message: message.trim(),
        hp,
        challengeId: challenge?.id,
        answer: answer.trim(),
      });
      if (!created || created.discarded) return; // 허니팟 등으로 버려진 경우
      setEntries((prev) => [created, ...prev]);
      setNick('');
      setMessage('');
      loadChallenge(); // 캡차는 1회용 → 새 문제
    } catch (err) {
      window.alert(err.message);
      if (err.captcha) loadChallenge(); // 캡차 오류면 새 문제로 갱신
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry) => {
    if (!window.confirm('이 방명록을 삭제할까요?')) return;
    await guestbookApi.deleteEntry(entry.id);
    setEntries((prev) => prev.filter((x) => x.id !== entry.id));
  };

  return (
    <section className="guestbook">
      <h2 className="gb-title">GUESTBOOK</h2>
      <p className="gb-sub">방명록</p>

      <form className="gb-form" onSubmit={submit}>
        <input
          className="gb-nick"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="닉네임"
          maxLength={NICK_MAX}
        />
        <textarea
          className="gb-msg"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="코멘트를 남겨주세요"
          maxLength={MSG_MAX}
          rows={3}
        />

        {/* 허니팟 — 사람에겐 안 보임. 봇이 채우면 서버가 걸러낸다 */}
        <input
          className="gb-hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
        />

        <div className="gb-form-foot">
          <label className="gb-captcha">
            스팸 방지: <strong>{challenge ? `${challenge.question} =` : '…'}</strong>
            <input
              className="gb-answer"
              type="text"
              inputMode="numeric"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="?"
              aria-label="계산 결과"
            />
          </label>
          <div className="gb-foot-right">
            <span className="gb-count">
              {message.length}/{MSG_MAX}
            </span>
            <button type="submit" className="gb-submit" disabled={!canSubmit}>
              {busy ? '남기는 중…' : '남기기'}
            </button>
          </div>
        </div>
      </form>

      <ul className="gb-list">
        {loading ? (
          <li className="gb-empty">불러오는 중…</li>
        ) : entries.length === 0 ? (
          <li className="gb-empty">아직 방명록이 없습니다. 첫 글을 남겨보세요!</li>
        ) : (
          entries.map((en) => (
            <li className="gb-entry" key={en.id}>
              <div className="gb-entry-head">
                <span className="gb-entry-nick">{en.nick}</span>
                <span className="gb-entry-date">{formatDate(en.createdAt)}</span>
                {isOwner && (
                  <button type="button" className="gb-del" onClick={() => remove(en)} aria-label="삭제">
                    ×
                  </button>
                )}
              </div>
              <p className="gb-entry-msg">{en.message}</p>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

export default Guestbook;
