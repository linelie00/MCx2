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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const { isOwner } = useOwner();

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
    return () => {
      alive = false;
    };
  }, []);

  const canSubmit = nick.trim() && message.trim() && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const created = await guestbookApi.addEntry({ nick: nick.trim(), message: message.trim() });
      setEntries((prev) => [created, ...prev]);
      setNick('');
      setMessage('');
    } catch (err) {
      window.alert(`등록 실패: ${err.message}`);
    }
    setBusy(false);
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
        <div className="gb-form-foot">
          <span className="gb-count">
            {message.length}/{MSG_MAX}
          </span>
          <button type="submit" className="gb-submit" disabled={!canSubmit}>
            {busy ? '남기는 중…' : '남기기'}
          </button>
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
