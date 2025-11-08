// Pages/CharacterPanel.jsx
import { useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import '../Styles/Character.css';

const CharacterPanel = () => {
  const { name } = useParams();
  const nav = useNavigate();

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && nav('..');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav]);

  const close = () => nav('..');       // /character 로 돌아감(허브는 유지)

  // TODO: name 기반 데이터 로딩
  // const data = useCharacter(name);

  return (
    <>
      {/* 배경 클릭 시 닫히는 오버레이 */}
      <div className="panel-backdrop" onClick={close} />

      {/* 오른쪽 패널(또는 중앙 모달) */}
      <aside className="panel">
        <h2 className="panel-title">{name}</h2>
        <div className="panel-body">
          {/* 캐릭터 상세 내용 */}
          {/* <img src={data.portrait} alt={data.displayName} /> */}
          {/* <p>{data.description}</p> */}
        </div>
      </aside>
    </>
  );
}

export default CharacterPanel;