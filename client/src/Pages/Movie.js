/**
 * Movie — /movie · MIHEARTI MOVIE NIGHT
 * 미하티 커플의 영화 관람 기록 페이지. 다른 페이지(양피지 톤)와 달리
 * 심야 영화관 분위기의 풀블리드 다크 모드로 구성한다.
 *
 * 구성: 네온사인 → 최근 본 영화 5개 캐러셀 → 월간 캘린더 → (날짜 클릭) 티켓 모달.
 * 데이터: 정적 데모(Data/movies.js) + 서버 API(/api/movie)를 합쳐 보여준다.
 *         오너는 로그인 후 영화를 추가/삭제할 수 있고, 추가분은 API에 저장된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../Styles/Movie.css';
import { movies as staticMovies } from '../Data/movies';
import * as movieApi from '../services/movieApi';
import { useOwner } from '../contexts/OwnerContext';
import NeonSign from '../Components/movie/NeonSign';
import PosterCarousel from '../Components/movie/PosterCarousel';
import MovieCalendar from '../Components/movie/MovieCalendar';
import TicketModal from '../Components/movie/TicketModal';
import AddMovieDialog from '../Components/movie/AddMovieDialog';

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

function Movie() {
  const [apiMovies, setApiMovies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editMovie, setEditMovie] = useState(null); // 캘린더에서 편집 중인 영화

  const { isOwner, ownerLabel, unlock, lock } = useOwner();

  useEffect(() => {
    let alive = true;
    movieApi
      .fetchMovies()
      .then((list) => alive && setApiMovies(list))
      .catch(() => {}); // 서버 미연결 시 정적 데모만 표시
    return () => {
      alive = false;
    };
  }, []);

  // 정적 데모 + API 영화 결합 (id 충돌 없음: 데모는 mv-*, API는 uuid)
  const allMovies = useMemo(() => [...apiMovies, ...staticMovies], [apiMovies]);
  const recent = useMemo(() => [...allMovies].sort(byDateDesc).slice(0, 5), [allMovies]);
  const moviesByDate = useMemo(
    () => allMovies.reduce((map, m) => ({ ...map, [m.date]: m }), {}),
    [allMovies]
  );
  const takenDates = useMemo(() => allMovies.map((m) => m.date), [allMovies]);

  const handleLockToggle = useCallback(async () => {
    if (isOwner) return lock();
    const key = window.prompt('관리자 패스코드를 입력하세요');
    if (!key) return undefined;
    try {
      await unlock(key.trim());
    } catch (e) {
      window.alert('패스코드가 올바르지 않습니다.');
    }
    return undefined;
  }, [isOwner, unlock, lock]);

  const handleAdd = useCallback(async (payload) => {
    const created = await movieApi.createMovie(payload);
    setApiMovies((prev) => [created, ...prev]);
  }, []);

  const handleUpdate = useCallback(async (id, patch) => {
    const updated = await movieApi.updateMovie(id, patch);
    setApiMovies((prev) => prev.map((m) => (m.id === id ? updated : m)));
    setSelected((cur) => (cur && cur.id === id ? updated : cur));
  }, []);

  const handleDelete = useCallback(async (movie) => {
    if (!movie.__api) return; // 정적 데모는 코드에서만 관리
    if (!window.confirm(`‘${movie.title}’ 기록을 삭제할까요?`)) return;
    await movieApi.deleteMovie(movie.id);
    setApiMovies((prev) => prev.filter((m) => m.id !== movie.id));
    setSelected(null);
  }, []);

  return (
    <div className="movie">
      {/* 배경: 빛바랜 빔/그레인 */}
      <div className="movie__bg" aria-hidden="true" />

      <header className="movie__hero">
        <NeonSign line1="MIHEARTI" line2="MOVIE NIGHT" />
        <p className="movie__tagline">미하티 심야 영화 기록</p>
        <div className="movie__owner">
          {isOwner && (
            <button type="button" className="movie__btn movie__btn--primary" onClick={() => setShowAdd(true)}>
              + 영화 추가
            </button>
          )}
          <button
            type="button"
            className={`movie__btn${isOwner ? ' is-owner' : ''}`}
            onClick={handleLockToggle}
          >
            {isOwner ? `${ownerLabel} · 로그아웃` : '관리자 로그인'}
          </button>
        </div>
      </header>

      <section className="movie__section">
        <h2 className="movie__heading">최근 본 영화</h2>
        <PosterCarousel movies={recent} />
      </section>

      <section className="movie__section">
        <h2 className="movie__heading">관람 캘린더</h2>
        <p className="movie__hint">포스터가 있는 날짜를 누르면 티켓이 열려요.</p>
        <MovieCalendar
          moviesByDate={moviesByDate}
          onSelect={setSelected}
          canEdit={isOwner}
          onEdit={setEditMovie}
        />
      </section>

      {selected && (
        <TicketModal
          movie={selected}
          onClose={() => setSelected(null)}
          canDelete={isOwner && !!selected.__api}
          onDelete={handleDelete}
          canEdit={isOwner && !!selected.__api}
          onSave={handleUpdate}
        />
      )}

      {showAdd && (
        <AddMovieDialog onSubmit={handleAdd} onClose={() => setShowAdd(false)} takenDates={takenDates} />
      )}

      {editMovie && (
        <AddMovieDialog
          initial={editMovie}
          onSubmit={(patch) => handleUpdate(editMovie.id, patch)}
          onClose={() => setEditMovie(null)}
          takenDates={takenDates.filter((d) => d !== editMovie.date)}
        />
      )}
    </div>
  );
}

export default Movie;
