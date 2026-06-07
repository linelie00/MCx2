/**
 * AddTrackDialog — 곡 추가 (오너 전용)
 * 두 가지 방식:
 *  - 이름으로 검색: search.list 결과에서 골라 추가(여러 곡 연속 추가 가능, 추가 후 다이얼로그 유지)
 *  - 링크 붙여넣기: 유튜브 URL/ID로 바로 추가
 * 선택/추가 시 서버가 videos.list로 제목·채널·썸네일·길이를 조회해 저장한다.
 */
import { useState } from 'react';
import * as playlistApi from '../../services/playlistApi';

function AddTrackDialog({ playlistTitle, onSubmit, onClose }) {
  const [mode, setMode] = useState('search'); // 'search' | 'link'
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  // 검색 모드
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [addedIds, setAddedIds] = useState([]);

  // 링크 모드
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const runSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    setError('');
    try {
      setResults(await playlistApi.searchTracks(query.trim()));
      setSearched(true);
    } catch (err) {
      setError(err.message || '검색에 실패했어요.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addResult = async (r) => {
    if (addingId) return;
    setAddingId(r.videoId);
    setError('');
    try {
      await onSubmit({ url: r.videoId, note: note.trim() });
      setAddedIds((p) => [...p, r.videoId]);
    } catch (err) {
      setError(err.message || '추가에 실패했어요.');
    } finally {
      setAddingId(null);
    }
  };

  const submitLink = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit({ url: url.trim(), note: note.trim() });
      onClose();
    } catch (err) {
      setError(err.message || '곡 정보를 가져오지 못했어요.');
      setBusy(false);
    }
  };

  return (
    <div className="gal-overlay pl-overlay" onClick={onClose}>
      <div className="pl-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="pl-dialog-title">곡 추가</h3>
        <p className="pl-dialog-sub">‘{playlistTitle}’에 추가</p>

        <div className="pl-modes">
          <button
            type="button"
            className={`pl-mode${mode === 'search' ? ' is-active' : ''}`}
            onClick={() => setMode('search')}
          >
            이름으로 검색
          </button>
          <button
            type="button"
            className={`pl-mode${mode === 'link' ? ' is-active' : ''}`}
            onClick={() => setMode('link')}
          >
            링크 붙여넣기
          </button>
        </div>

        <label className="pl-field">
          <span className="pl-field-label">메모 (선택, 추가하는 곡에 함께 저장)</span>
          <input
            className="pl-field-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="이 곡에 대한 한마디"
            maxLength={300}
          />
        </label>

        {mode === 'search' ? (
          <>
            <form className="pl-search-form" onSubmit={runSearch}>
              <input
                className="pl-field-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="곡 이름 / 아티스트로 검색"
                autoFocus
              />
              <button type="submit" className="pl-btn" disabled={!query.trim() || searching}>
                {searching ? '검색 중…' : '검색'}
              </button>
            </form>

            {error ? <p className="pl-dialog-error">{error}</p> : null}

            <div className="pl-search-results">
              {results.map((r) => {
                const added = addedIds.includes(r.videoId);
                return (
                  <div className="pl-result" key={r.videoId}>
                    {r.thumbnail ? <img className="pl-result-thumb" src={r.thumbnail} alt="" /> : <span className="pl-result-thumb" />}
                    <div className="pl-result-info">
                      <div className="pl-result-title">{r.title}</div>
                      <div className="pl-result-channel">{r.channel}</div>
                    </div>
                    <button
                      type="button"
                      className="pl-btn pl-btn--primary"
                      onClick={() => addResult(r)}
                      disabled={added || addingId === r.videoId}
                    >
                      {added ? '추가됨' : addingId === r.videoId ? '추가 중…' : '추가'}
                    </button>
                  </div>
                );
              })}
              {!searching && searched && results.length === 0 ? (
                <p className="pl-search-hint">검색 결과가 없어요.</p>
              ) : null}
              {!searched ? <p className="pl-search-hint">곡 이름을 입력해 검색하세요.</p> : null}
            </div>

            <div className="pl-dialog-actions">
              <button type="button" className="pl-btn" onClick={onClose}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submitLink}>
            <label className="pl-field">
              <span className="pl-field-label">유튜브 링크 또는 영상 ID</span>
              <input
                className="pl-field-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtu.be/..."
              />
            </label>

            {error ? <p className="pl-dialog-error">{error}</p> : null}

            <div className="pl-dialog-actions">
              <button type="button" className="pl-btn" onClick={onClose}>
                취소
              </button>
              <button type="submit" className="pl-btn pl-btn--primary" disabled={!url.trim() || busy}>
                {busy ? '가져오는 중…' : '추가'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default AddTrackDialog;
