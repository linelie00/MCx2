/**
 * StoryTimeline
 * 네비게이션 바 아래에 붙는 스토리 진행(세션) 타임라인.
 * 세션을 순서대로(주점 이니트 → 도브 돌라 → ...) 가로로 나열하고,
 * 클릭하면 해당 세션으로 이동(선택)한다. 현재 세션은 강조된다.
 *
 * props:
 *  - sessions: stories[]  (order 순으로 정렬되어 있다고 가정)
 *  - activeId: 현재 세션 id
 *  - onSelect: (id) => void
 */
export default function StoryTimeline({ sessions, activeId, onSelect }) {
  return (
    <nav className="story-timeline" aria-label="스토리 진행">
      <ol className="story-timeline-track">
        {sessions.map((s) => (
          <li
            key={s.id}
            className={`story-node ${s.id === activeId ? 'is-active' : ''}`}
          >
            <button
              type="button"
              className="story-node-btn"
              onClick={() => onSelect(s.id)}
              aria-current={s.id === activeId ? 'true' : undefined}
            >
              <span className="story-node-seal">{s.order}</span>
              <span className="story-node-title">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
