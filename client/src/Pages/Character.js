import { useParams } from 'react-router-dom';

export default function Character() {
  const { name } = useParams();
  return (
    <main>
      <h1>{name}</h1>
      {/* name 기반으로 데이터 로드/렌더링 */}
    </main>
  );
}