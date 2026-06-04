/**
 * Gallery — /image
 * 핀터레스트풍 메이슨리 갤러리. 태그 무관 랜덤 정렬이 기본이며, 태그를 고르면 필터된다.
 * 이미지/태그 추가·삭제 지원. 현재는 galleryApi(목)로 동작하고 추후 Express API로 교체된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import '../Styles/Gallery.css';
import * as galleryApi from '../services/galleryApi';
import TagFilterBar from '../Components/gallery/TagFilterBar';
import GalleryGrid from '../Components/gallery/GalleryGrid';
import GalleryModal from '../Components/gallery/GalleryModal';
import UploadDialog from '../Components/gallery/UploadDialog';

const PAGE = 12; // 무한스크롤 한 번에 늘릴 카드 수

// seed 기반 결정적 셔플 — 같은 seed면 순서가 고정돼 무한스크롤 중 흔들리지 않는다.
function seededShuffle(list, seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function Gallery() {
  const [allImages, setAllImages] = useState([]);
  const [tags, setTags] = useState([]);
  const [activeTags, setActiveTags] = useState([]); // 다중 선택 (AND)
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const [seed] = useState(() => Math.floor(Math.random() * 1e9)); // 방문마다 새 랜덤 순서
  const [selected, setSelected] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([galleryApi.fetchImages(), galleryApi.fetchTags()]).then(([imgs, tgs]) => {
      if (!alive) return;
      setAllImages(imgs);
      setTags(tgs);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const tagLabels = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t.label])), [tags]);

  // 필터(AND) → 셔플 (seed 고정). 태그 선택이 바뀌면 노출 수를 초기화한다.
  const display = useMemo(() => {
    const filtered =
      activeTags.length === 0
        ? allImages
        : allImages.filter((i) => activeTags.every((t) => i.tags.includes(t)));
    return seededShuffle(filtered, seed);
  }, [allImages, activeTags, seed]);

  const visible = display.slice(0, visibleCount);
  const hasMore = visibleCount < display.length;

  const toggleTag = useCallback((tagId) => {
    setActiveTags((prev) =>
      prev.includes(tagId) ? prev.filter((t) => t !== tagId) : [...prev, tagId]
    );
    setVisibleCount(PAGE);
  }, []);

  const clearTags = useCallback(() => {
    setActiveTags([]);
    setVisibleCount(PAGE);
  }, []);

  const loadMore = useCallback(() => setVisibleCount((c) => c + PAGE), []);

  const handleCreateTag = useCallback(async (label) => {
    const tag = await galleryApi.createTag(label);
    setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    return tag;
  }, []);

  const handleDeleteTag = useCallback(async (tagId) => {
    await galleryApi.deleteTag(tagId);
    setTags((prev) => prev.filter((t) => t.id !== tagId));
    setAllImages((prev) =>
      prev.map((i) => (i.tags.includes(tagId) ? { ...i, tags: i.tags.filter((t) => t !== tagId) } : i))
    );
    setActiveTags((prev) => prev.filter((t) => t !== tagId));
  }, []);

  const handleUpload = useCallback(async (payload) => {
    const created = await galleryApi.uploadImage(payload);
    setAllImages((prev) => [created, ...prev]);
  }, []);

  const handleDelete = useCallback(async (image) => {
    await galleryApi.deleteImage(image.id);
    setAllImages((prev) => prev.filter((i) => i.id !== image.id));
    setSelected(null);
  }, []);

  const handleSaveTags = useCallback(async (image, nextTags) => {
    const updated = await galleryApi.updateImageTags(image.id, nextTags);
    setAllImages((prev) => prev.map((i) => (i.id === image.id ? updated : i)));
    setSelected((cur) => (cur && cur.id === image.id ? updated : cur));
  }, []);

  return (
    <div className="gallery">
      <header className="gal-head">
        <h2 className="gal-title">Gallery</h2>
        <button type="button" className="gal-btn gal-btn--primary gal-add" onClick={() => setUploadOpen(true)}>
          + 이미지 추가
        </button>
      </header>

      <TagFilterBar
        tags={tags}
        active={activeTags}
        onToggle={toggleTag}
        onClear={clearTags}
        onCreateTag={handleCreateTag}
        onDeleteTag={handleDeleteTag}
      />

      {loading ? (
        <p className="gal-empty">불러오는 중…</p>
      ) : (
        <GalleryGrid
          items={visible}
          tagLabels={tagLabels}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onOpen={setSelected}
        />
      )}

      {selected && (
        <GalleryModal
          image={selected}
          tagLabels={tagLabels}
          allTags={tags}
          onCreateTag={handleCreateTag}
          onSaveTags={handleSaveTags}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}

      {uploadOpen && (
        <UploadDialog
          allTags={tags}
          onCreateTag={handleCreateTag}
          onSubmit={handleUpload}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  );
}

export default Gallery;
