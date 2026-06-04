/**
 * TagFilterBar — 상단 태그 필터
 * - '전체'(선택 없음)가 기본. 칩을 누르면 다중 선택(AND: 고른 태그를 모두 가진 이미지만).
 * - 태그가 많아질 수 있어 검색창으로 칩 목록을 좁힌다.
 */
import { useState } from 'react';

function TagFilterBar({ tags, active, onToggle, onClear }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? tags.filter((t) => t.label.toLowerCase().includes(q)) : tags;

  return (
    <div className="gal-tagbar">
      <div className="gal-tagbar-top">
        <input
          className="gal-tagsearch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="태그 검색…"
        />
        {active.length > 0 && (
          <span className="gal-tagbar-info">{active.length}개 선택</span>
        )}
      </div>

      <div className="gal-chips">
        <button
          type="button"
          className={`gal-chip${active.length === 0 ? ' is-active' : ''}`}
          onClick={onClear}
        >
          전체
        </button>
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`gal-chip${active.includes(t.id) ? ' is-active' : ''}`}
            onClick={() => onToggle(t.id)}
          >
            {t.label}
          </button>
        ))}
        {shown.length === 0 && <span className="gal-tagbar-info">검색 결과 없음</span>}
      </div>
    </div>
  );
}

export default TagFilterBar;
