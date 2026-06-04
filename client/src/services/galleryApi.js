/**
 * galleryApi.js — 갤러리 데이터 접근 계층
 *
 * 현재는 목 데이터를 메모리에 두고 Promise로 응답한다(서버 없이 UI 검증용).
 * 추후 fetch('/api/gallery/*') 구현으로 이 파일만 교체하면 컴포넌트는 그대로 동작한다.
 */
import { mockImages, mockTags } from '../Data/gallery';

let images = mockImages.map((i) => ({ ...i, createdAt: i.createdAt || new Date().toISOString() }));
let tags = [...mockTags];

const delay = (ms = 150) => new Promise((res) => setTimeout(res, ms));
const slug = (label) =>
  label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '') || `tag-${Date.now()}`;
const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

// 태그로 필터링한 이미지 목록 (tag 없으면 전체)
export async function fetchImages({ tag } = {}) {
  await delay();
  return tag ? images.filter((i) => i.tags.includes(tag)) : images.slice();
}

export async function fetchTags() {
  await delay();
  return tags.slice();
}

// 업로드 — UI 단계에서는 blob URL + 클라이언트 측정 치수를 그대로 저장
export async function uploadImage({ url, width, height, tags: imgTags = [] }) {
  await delay();
  const img = {
    id: uid(),
    url,
    width,
    height,
    tags: imgTags.slice(0, 2),
    createdAt: new Date().toISOString(),
  };
  images = [img, ...images];
  return img;
}

export async function deleteImage(id) {
  await delay();
  images = images.filter((i) => i.id !== id);
}

export async function updateImageTags(id, nextTags) {
  await delay();
  images = images.map((i) => (i.id === id ? { ...i, tags: nextTags.slice(0, 2) } : i));
  return images.find((i) => i.id === id);
}

export async function createTag(label) {
  await delay();
  const id = slug(label);
  if (!tags.some((t) => t.id === id)) tags = [...tags, { id, label: label.trim() }];
  return tags.find((t) => t.id === id);
}

const galleryApi = { fetchImages, fetchTags, uploadImage, deleteImage, updateImageTags, createTag };
export default galleryApi;
