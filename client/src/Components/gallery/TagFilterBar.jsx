/**
 * TagFilterBar — 상단 태그 필터 + 태그 관리
 * - 기본 모드: '전체'(선택 없음)가 기본, 칩 다중 선택(AND: 고른 태그를 모두 가진 이미지만).
 * - 검색창으로 칩 목록을 좁힌다(태그가 많아질 수 있어).
 * - '태그 관리' 모드: 칩 클릭 시 이름 편집(rename), ×(삭제), 하단에 새 태그 추가 입력.
 */
import { useState } from 'react';

function TagFilterBar({
  tags,
  active,
  onToggle,
  onClear,
  canManage = false,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  onReorder,
}) {
  const [query, setQuery] = useState('');
  const [manage, setManage] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [dragId, setDragId] = useState(null);

  const q = query.trim().toLowerCase();
  const shown = q ? tags.filter((t) => t.label.toLowerCase().includes(q)) : tags;
  const inManage = manage && canManage; // 권한이 없으면 관리 모드를 강제 해제

  const handleDelete = (tag) => {
    if (window.confirm(`'${tag.label}' 태그를 삭제할까요?\n모든 이미지에서 이 태그가 제거됩니다.`)) {
      onDeleteTag(tag.id);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const label = newTag.trim();
    if (!label) return;
    await onCreateTag(label);
    setNewTag('');
  };

  const startEdit = (tag) => {
    setEditingId(tag.id);
    setEditLabel(tag.label);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
  };
  const commitEdit = async (tag) => {
    const label = editLabel.trim();
    if (label && label !== tag.label) await onRenameTag(tag.id, label);
    cancelEdit();
  };

  // 드래그로 순서 변경: dragId를 targetId 위치로 이동
  const handleDrop = (targetId) => {
    if (!dragId || dragId === targetId) return setDragId(null);
    const ids = tags.map((t) => t.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return setDragId(null);
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    onReorder(ids);
    return setDragId(null);
  };

  return (
    <div className="gal-tagbar">
      <div className="gal-tagbar-top">
        <input
          className="gal-tagsearch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="태그 검색…"
        />
        {!inManage && active.length > 0 && <span className="gal-tagbar-info">{active.length}개 선택</span>}
        {canManage && (
          <button
            type="button"
            className={`gal-tagmanage${manage ? ' is-active' : ''}`}
            onClick={() => setManage((m) => !m)}
          >
            {manage ? '완료' : '태그 관리'}
          </button>
        )}
      </div>

      {inManage && (
        <p className="gal-manage-hint">⠿ 손잡이를 드래그해 순서 변경 · 이름 클릭 시 수정 · × 삭제</p>
      )}

      <div className="gal-chips">
        {!inManage && (
          <button
            type="button"
            className={`gal-chip${active.length === 0 ? ' is-active' : ''}`}
            onClick={onClear}
          >
            전체
          </button>
        )}

        {shown.map((t) =>
          inManage ? (
            <span
              className={`gal-chip gal-chip--manage${dragId === t.id ? ' is-dragging' : ''}`}
              key={t.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(t.id)}
            >
              <span
                className="gal-chip-grip"
                draggable
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => setDragId(null)}
                role="button"
                tabIndex={-1}
                aria-label="드래그하여 순서 변경"
                title="드래그하여 순서 변경"
              >
                ⠿
              </span>
              {editingId === t.id ? (
                <input
                  className="gal-chip-edit"
                  value={editLabel}
                  autoFocus
                  onChange={(e) => setEditLabel(e.target.value)}
                  onBlur={() => commitEdit(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(t);
                    if (e.key === 'Escape') cancelEdit();
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="gal-chip-label"
                  onClick={() => startEdit(t)}
                  title="클릭하여 이름 변경"
                >
                  {t.label}
                </button>
              )}
              <button
                type="button"
                className="gal-chip-x"
                onClick={() => handleDelete(t)}
                aria-label={`${t.label} 삭제`}
              >
                ×
              </button>
            </span>
          ) : (
            <button
              key={t.id}
              type="button"
              className={`gal-chip${active.includes(t.id) ? ' is-active' : ''}`}
              onClick={() => onToggle(t.id)}
            >
              {t.label}
            </button>
          )
        )}

        {!inManage && shown.length === 0 && <span className="gal-tagbar-info">검색 결과 없음</span>}

        {inManage && (
          <form className="gal-tagadd" onSubmit={handleAdd}>
            <input
              className="gal-tagadd-field"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              placeholder="새 태그"
            />
            <button type="submit" className="gal-chip gal-chip--add">
              + 추가
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default TagFilterBar;
