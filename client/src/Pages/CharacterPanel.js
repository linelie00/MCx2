import { useParams } from 'react-router-dom';
import '../Styles/Character.css';
import characters from '../Data/Characters.js';

const InfoItem = ({ label, value }) => {
  if (!value) return null;

  return (
    <div className="info-item">
      <span className="label">[{label}]</span>
      <span className="value">{value}</span>
    </div>
  );
};

const CharacterPanel = () => {
  const { name = '' } = useParams();
  const character = characters[name];

  if (!character) return <div>캐릭터 없음</div>;

  const desc = character.description;

  const fields = [
    { key: "job", label: "직업" },
    { key: "body", label: "키/체형" },
    { key: "gender", label: "성별" },
    { key: "race", label: "종족" },
    { key: "age", label: "나이" },
    { key: "enlistment_period", label: "모험단에 입단한 기간" },
    { key: "personality", label: "성격"},
    {key: "etc", label: "기타"}
  ];

  return (
    <div className="panel_content" style={{ '--panel-bg': character.color }}>
      <div className="panel-inner">

        {/* 제목 */}
        <div className="panel-title">
          <h2>"{character.title}"</h2>
        </div>

        {/* 헤더 */}
        <div className="panel-header">
          <img src={character.portrait} alt={character.name} />
          <p>{character.name}</p>
        </div>

        {/* 기본 정보 */}
        <div className="panel-body">
          {fields.map(({ key, label }) => (
            <InfoItem key={key} label={label} value={desc?.[key]} />
          ))}
        </div>

        {/* 외형 */}
        {character.appearance?.description && (
          <div className="panel-section">
            <h3>외형</h3>
            <p>{character.appearance.description}</p>
          </div>
        )}

        {/* 성격 */}
        {character.personality && (
          <div className="panel-section">
            <h3>성격</h3>
            <p>{character.personality}</p>
          </div>
        )}

        {/* 기타 */}
        {character.etc && (
          <div className="panel-section">
            <h3>기타</h3>
            <p>{character.etc}</p>
          </div>
        )}

        {/* 대사 */}
        <div className="panel-quotes">
          {character.quotes.map((q, i) => (
            <p key={i}>"{q}"</p>
          ))}
        </div>

      </div>
    </div>
  );
};

export default CharacterPanel;