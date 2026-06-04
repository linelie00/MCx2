/**
 * galleryController — 갤러리 API 로직
 * 메타데이터는 metaStore(gallery.json), 파일은 storageService(uploads/)가 담당.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const metaStore = require('../services/metaStore');
const storage = require('../services/storageService');

const MAX_TAGS = 10; // 이미지당 최대 태그 수

const slug = (label) =>
  label.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w가-힣-]/g, '') || `tag-${Date.now()}`;

// 태그 id 배열에 대해 메타에 없는 태그를 생성(label=id 기본)
function ensureTags(data, tagIds) {
  for (const id of tagIds) {
    if (!data.tags.some((t) => t.id === id)) data.tags.push({ id, label: id });
  }
}

function parseTags(body) {
  if (!body || body.tags == null) return [];
  try {
    const parsed = JSON.parse(body.tags);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [].concat(body.tags);
  }
}

exports.listImages = (req, res) => {
  const { tag } = req.query;
  const data = metaStore.read();
  const images = tag ? data.images.filter((i) => i.tags.includes(tag)) : data.images;
  res.json(images);
};

const fileId = (f) => f.filename.replace(/\.[^.]+$/, '');

// 다중 업로드. group=true 이고 2장 이상이면 하나의 앨범(items[])으로 묶고,
// 아니면 각각 개별 카드로 만든다. 응답은 생성된 엔트리 배열.
exports.createImages = async (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'file(s) required' });
  try {
    const tags = parseTags(req.body).slice(0, MAX_TAGS);
    const group = String(req.body.group) === 'true';
    const now = () => new Date().toISOString();

    // 모든 파일을 먼저 처리(치수 측정 + 영상 poster)
    const medias = [];
    for (const f of files) {
      // eslint-disable-next-line no-await-in-loop
      const m = await storage.processSaved(f, fileId(f));
      medias.push(m);
    }

    const data = metaStore.read();
    let created = [];

    if (group && medias.length > 1) {
      const cover = medias[0];
      const entry = {
        id: crypto.randomUUID(),
        type: cover.type,
        url: cover.url,
        ...(cover.poster ? { poster: cover.poster } : {}),
        width: cover.width,
        height: cover.height,
        items: medias,
        tags,
        createdAt: now(),
      };
      data.images.unshift(entry);
      created = [entry];
    } else {
      // 개별: 선택 순서를 유지하며 맨 앞에 추가
      created = medias.map((m, i) => ({
        id: fileId(files[i]),
        type: m.type,
        url: m.url,
        ...(m.poster ? { poster: m.poster } : {}),
        width: m.width,
        height: m.height,
        tags,
        createdAt: now(),
      }));
      for (let i = created.length - 1; i >= 0; i -= 1) data.images.unshift(created[i]);
    }

    ensureTags(data, tags);
    metaStore.write(data);
    res.status(201).json(created);
  } catch (e) {
    res.status(500).json({ error: 'upload failed', detail: String(e.message || e) });
  }
};

exports.deleteImage = (req, res) => {
  const data = metaStore.read();
  const image = data.images.find((i) => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'not found' });
  storage.removeFiles(image);
  data.images = data.images.filter((i) => i.id !== req.params.id);
  metaStore.write(data);
  res.status(204).end();
};

exports.updateImageTags = (req, res) => {
  const data = metaStore.read();
  const image = data.images.find((i) => i.id === req.params.id);
  if (!image) return res.status(404).json({ error: 'not found' });
  const tags = (Array.isArray(req.body.tags) ? req.body.tags : []).slice(0, MAX_TAGS);
  image.tags = tags;
  ensureTags(data, tags);
  metaStore.write(data);
  res.json(image);
};

// 파일 다운로드 — Content-Disposition: attachment 로 강제 다운로드(영상 포함 스트리밍).
// 파일명 기반이라 앨범의 현재 항목 파일도 그대로 받을 수 있다.
exports.downloadFile = (req, res) => {
  const name = path.basename(req.params.name); // 경로 탈출 방지
  const filePath = path.join(storage.UPLOADS_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'not found' });
  return res.download(filePath, name);
};

exports.listTags = (req, res) => {
  res.json(metaStore.read().tags);
};

exports.createTag = (req, res) => {
  const label = (req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label is required' });
  const id = slug(label);
  const data = metaStore.read();
  if (!data.tags.some((t) => t.id === id)) {
    data.tags.push({ id, label });
    metaStore.write(data);
  }
  res.status(201).json(data.tags.find((t) => t.id === id));
};

// 태그 순서 변경 — ids 배열 순서대로 재정렬(목록에 없는 태그는 뒤에 보존).
exports.reorderTags = (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const data = metaStore.read();
  const byId = new Map(data.tags.map((t) => [t.id, t]));
  const ordered = [];
  for (const id of ids) {
    if (byId.has(id)) {
      ordered.push(byId.get(id));
      byId.delete(id);
    }
  }
  for (const t of byId.values()) ordered.push(t); // 누락분 보존
  data.tags = ordered;
  metaStore.write(data);
  res.json(data.tags);
};

// 태그 이름 변경 — id는 그대로 두고 label만 바꾼다(이미지는 id로 참조하므로 연결 유지).
exports.renameTag = (req, res) => {
  const { id } = req.params;
  const label = (req.body.label || '').trim();
  if (!label) return res.status(400).json({ error: 'label is required' });
  const data = metaStore.read();
  const tag = data.tags.find((t) => t.id === id);
  if (!tag) return res.status(404).json({ error: 'not found' });
  tag.label = label;
  metaStore.write(data);
  res.json(tag);
};

// 태그 삭제 — 목록에서 제거하고 모든 이미지의 tags에서도 떼어낸다(이미지는 유지).
exports.deleteTag = (req, res) => {
  const { id } = req.params;
  const data = metaStore.read();
  data.tags = data.tags.filter((t) => t.id !== id);
  data.images = data.images.map((img) =>
    img.tags.includes(id) ? { ...img, tags: img.tags.filter((t) => t !== id) } : img
  );
  metaStore.write(data);
  res.status(204).end();
};
