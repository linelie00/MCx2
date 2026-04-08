import { useParams } from 'react-router-dom';
import '../Styles/Character.css';
import characters from '../Data/Characters.js';
import { ReactComponent as Tear } from '../Assets/Images/tear.svg';
import imgJ4W from '../Assets/Images/img_J4Wseal.png';

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
    { key: "job", label: "칭호 혹은 직업" },
    { key: "body", label: "키/체형" },
    { key: "gender", label: "성별" },
    { key: "race", label: "종족" },
    { key: "age", label: "나이" },
    { key: "enlistment_period", label: "모험단에 입단한 기간" },
    { key: "personality", label: "성격"},
    {key: "etc", label: "기타"},
    {key: "belongings", label: "소지품"}
  ];

  return (
    <div className="panel_content" style={{ '--panel-bg': character.color }}>
      <div className="panel-inner">

        {/* 제목 */}
        <div className="panel-title">
          <h2>"{character.title}"</h2>
        </div>

        <div className="panel-appearance">
          <img src={character.appearance.image} alt={character.name}/>
          <div className="panel-appearance-content">
            <div className="info-item">
              <span className="label">&#91;외관&#93;</span>
            <p>{character.appearance.description}</p>
            </div>
            <div className="info-item">
              <span className="label">&#91;무기&#93;</span>
              <img src={character.weapon} alt={character.name} />
            </div>
            <div className="row-box">
              <div className="info-item">
                <span className="label">&#91;스탯&#93;</span>
                {character.stats?.map((s, i) => (
                  <div className="stat-row" key={i}>
                    <span className="stat-label">{s.label}</span>
                    <span className="stat-value">{s.value}</span>
                  </div>
                ))}
              </div>
              <div className="info-item">
                <span className="label">&#91;기술&#93;</span>
                {character.skill?.map((s, i) => (
                  <div className="skill-row" key={i}>
                    <span className="skill-label">{s.label}</span>
                    <span className="skill-value">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 기본 정보 */}
        <div className="panel-body">
          <img src={imgJ4W} className="stamp" />
          <img src={imgJ4W} className="stamp stamp-reverse" />
          <Tear className="tear-top" />
          <Tear className="tear-bottom" />
          <div className="panel-header">
            <img src={character.portrait} alt={character.name} />
            <p>{character.name}</p>
          </div>
          {fields.map(({ key, label }) => (
            <InfoItem key={key} label={label} value={desc?.[key]} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default CharacterPanel;