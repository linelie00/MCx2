import { useEffect, useState } from 'react';
import '../Styles/Story.css';
import { stories } from '../Data/stories';
import characters from '../Data/Characters';
import { getStoryImage } from '../Data/storyImages';
import StoryTimeline from '../Components/story/StoryTimeline';

// "미겔 / Migel" → "미겔"
const shortName = (full) => full.split('/')[0].trim();

const Story = () => {
  const [activeId, setActiveId] = useState(stories[0].id);
  const session = stories.find((s) => s.id === activeId) ?? stories[0];

  // 세션을 바꾸면 본문 맨 위로
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [activeId]);

  return (
    <div className="story">
      <StoryTimeline sessions={stories} activeId={activeId} onSelect={setActiveId} />

      <article className="story-parchment">
        <header className="story-head">
          <span className="story-order">CHAPTER {session.order}</span>
          <h2 className="story-title">{session.title}</h2>
        </header>

        {session.scenes.map((scene) => (
          <section className="story-scene" key={scene.id}>
            {scene.label && (
              <div className="story-scene-label">
                <span>{scene.label}</span>
              </div>
            )}

            <div className="story-lines">
              {scene.lines.map((line, i) => {
                const ch = characters[line.speaker];
                const name = shortName(ch.name);
                return (
                  <div
                    className={`story-line story-line--${line.speaker}`}
                    key={i}
                    style={{ '--accent': ch.color }}
                  >
                    <div className="story-speaker">
                      <img className="story-portrait" src={ch.portrait} alt={name} />
                      <span className="story-name">{name}</span>
                    </div>
                    <div className="story-bubble">
                      {line.text && <p className="story-text">{line.text}</p>}
                      {'image' in line && getStoryImage(session.id, line.speaker) && (
                        <img
                          className="story-illust"
                          src={getStoryImage(session.id, line.speaker)}
                          alt={`${name} 삽화`}
                          loading="lazy"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </article>
    </div>
  );
};

export default Story;
