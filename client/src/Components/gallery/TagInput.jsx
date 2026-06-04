/**
 * TagInput — 노션식 태그 선택/생성 (이미지당 최대 2개)
 * - 기존 태그 칩을 눌러 토글
 * - 입력 후 Enter로 새 태그 생성(없으면 onCreate 호출)
 */
import { useMemo, useState } from 'react';

const MAX_TAGS = 2;

function TagInput({ allTags, value, onChange, onCreate }) {
  const [text, setText] = useState('');
  const labelById = useMemo(
    () => Object.fromEntries(allTags.map((t) => [t.id, t.label])),
    [allTags]
  );

  const toggle = (id) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (value.length < MAX_TAGS) {
      onChange([...value, id]);
    }
  };

  const suggestions = allTags.filter(
    (t) => !value.includes(t.id) && t.label.toLowerCase().includes(text.trim().toLowerCase())
  );

  const handleKeyDown = async (e) => {
    if (e.key !== 'Enter' || !text.trim()) return;
    e.preventDefault();
    if (value.length >= MAX_TAGS) return;
    const label = text.trim();
    const existing = allTags.find((t) => t.label.toLowerCase() === label.toLowerCase());
    const tag = existing || (await onCreate(label));
    if (tag && !value.includes(tag.id)) onChange([...value, tag.id]);
    setText('');
  };

  return (
    <div className="gal-taginput">
      <div className="gal-taginput-selected">
        {value.length === 0 && <span className="gal-taginput-empty">태그 선택 (최대 {MAX_TAGS}개)</span>}
        {value.map((id) => (
          <span className="gal-taginput-chip" key={id}>
            {labelById[id] || id}
            <button type="button" className="gal-taginput-x" onClick={() => toggle(id)} aria-label="제거">
              ×
            </button>
          </span>
        ))}
      </div>

      <input
        className="gal-taginput-field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length >= MAX_TAGS ? '태그가 가득 찼습니다' : '태그 입력 후 Enter로 추가/생성'}
        disabled={value.length >= MAX_TAGS}
      />

      {text.trim() && suggestions.length > 0 && (
        <div className="gal-taginput-suggest">
          {suggestions.map((t) => (
            <button key={t.id} type="button" className="gal-taginput-suggest-item" onClick={() => { toggle(t.id); setText(''); }}>
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default TagInput;
