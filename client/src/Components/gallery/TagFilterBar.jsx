/**
 * TagFilterBar — 상단 태그 필터 + 태그 관리
 * - 기본 모드: '전체'(선택 없음)가 기본, 칩 다중 선택(AND: 고른 태그를 모두 가진 이미지만).
 * - 검색창으로 칩 목록을 좁힌다(태그가 많아질 수 있어).
 * - '태그 관리' 모드: 칩 클릭 시 이름 편집(rename), ×(삭제), 하단에 새 태그 추가 입력.
 */
import { useLayoutEffect, useRef, useState } from 'react';

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
  const [over, setOver] = useState(null); // { id, after } — 어느 칩의 앞/뒤에 삽입할지
  const overRef = useRef(null); // onUp(stale 클로저)에서 최종값 참조용
  const chipRefs = useRef(new Map()); // id -> 칩 DOM
  const prevRects = useRef(new Map()); // id -> 직전 위치(FLIP)

  const q = query.trim().toLowerCase();
  const shown = q ? tags.filter((t) => t.label.toLowerCase().includes(q)) : tags;
  const inManage = manage && canManage; // 권한이 없으면 관리 모드를 강제 해제

  // 드래그 중에는 미리보기 순서로 렌더 → 끌고 있는 칩이 들어갈 자리가 실시간으로 비워진다.
  // over가 null이면 원래 순서 그대로(원위치 복귀 가능).
  const renderList = (() => {
    if (!inManage || !dragId) return shown;
    const byId = new Map(shown.map((t) => [t.id, t]));
    return orderWith(dragId, over).map((id) => byId.get(id)).filter(Boolean);
  })();

  // FLIP: 칩 위치가 바뀌면 부드럽게 미끄러지게 한다(사이가 벌어지는 느낌)
  useLayoutEffect(() => {
    const refs = chipRefs.current;
    if (!inManage) {
      prevRects.current = new Map();
      return;
    }
    // 1) 잔여 transform 제거 후 실제 위치 측정
    refs.forEach((el) => {
      if (el) {
        el.style.transition = 'none';
        el.style.transform = '';
      }
    });
    const newRects = new Map();
    refs.forEach((el, id) => {
      if (el) newRects.set(id, el.getBoundingClientRect());
    });
    // 2) 직전 위치에서 현재 위치로 역변환 적용
    let animated = false;
    refs.forEach((el, id) => {
      const prev = prevRects.current.get(id);
      const cur = newRects.get(id);
      if (el && prev && cur) {
        const dx = prev.left - cur.left;
        const dy = prev.top - cur.top;
        if (dx || dy) {
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          animated = true;
        }
      }
    });
    // 3) 다음 프레임에 원위치로 트랜지션 → 미끄러짐
    if (animated) {
      requestAnimationFrame(() => {
        refs.forEach((el) => {
          if (el && el.style.transform) {
            el.style.transition = 'transform 160ms ease';
            el.style.transform = '';
          }
        });
      });
    }
    prevRects.current = newRects;
  });

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

  // dragId를 제거한 목록에서 over(앞/뒤 삽입점) 기준으로 재배열한 id 배열을 만든다.
  // over가 null이면 원래 순서(= 원위치 복귀 가능). 함수 선언이라 renderList보다 위에서 호출 가능(호이스팅).
  function orderWith(dragged, ov) {
    const others = shown.filter((t) => t.id !== dragged);
    if (!ov) return shown.map((t) => t.id);
    let idx = others.findIndex((t) => t.id === ov.id);
    if (idx < 0) return shown.map((t) => t.id);
    if (ov.after) idx += 1;
    const ids = others.map((t) => t.id);
    ids.splice(idx, 0, dragged);
    return ids;
  }

  // 포인터(마우스/터치) 기반 드래그 — 네이티브 DnD에 의존하지 않는다.
  const startPointerDrag = (e, id) => {
    e.preventDefault();
    setDragId(id);
    overRef.current = null;
    setOver(null);
    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const chip = el && el.closest('[data-tagid]');
      if (!chip) return; // 칩 밖이면 현재 미리보기 유지
      const overId = chip.getAttribute('data-tagid');
      if (overId === id) return; // 드래그 중인 칩 자신 위면 유지(자기 자신은 타깃 제외)
      const rect = chip.getBoundingClientRect();
      const after = ev.clientX > rect.left + rect.width / 2; // 칩의 좌/우 절반으로 앞·뒤 결정
      const next = { id: overId, after };
      overRef.current = next;
      setOver(next);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const ids = orderWith(id, overRef.current);
      const orig = shown.map((t) => t.id);
      if (JSON.stringify(ids) !== JSON.stringify(orig)) onReorder(ids);
      setDragId(null);
      setOver(null);
      overRef.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
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

        {renderList.map((t) =>
          inManage ? (
            <span
              className={`gal-chip gal-chip--manage${dragId === t.id ? ' is-dragging' : ''}`}
              key={t.id}
              data-tagid={t.id}
              ref={(el) => {
                const m = chipRefs.current;
                if (el) m.set(t.id, el);
                else m.delete(t.id);
              }}
            >
              {!q && (
                <span
                  className="gal-chip-grip"
                  onPointerDown={(e) => startPointerDrag(e, t.id)}
                  role="button"
                  tabIndex={-1}
                  aria-label="드래그하여 순서 변경"
                  title="드래그하여 순서 변경"
                >
                  ⠿
                </span>
              )}
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
