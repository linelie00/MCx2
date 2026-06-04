/**
 * galleryController — 갤러리 API 로직
 * 메타데이터는 metaStore(gallery.json), 파일은 storageService(uploads/)가 담당.
 */
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

exports.createImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  try {
    const id = req.file.filename.replace(/\.[^.]+$/, '');
    const tags = parseTags(req.body).slice(0, MAX_TAGS);
    const media = await storage.processSaved(req.file, id);

    const entry = {
      id,
      type: media.type,
      url: media.url,
      ...(media.poster ? { poster: media.poster } : {}),
      width: media.width,
      height: media.height,
      tags,
      createdAt: new Date().toISOString(),
    };

    const data = metaStore.read();
    data.images.unshift(entry);
    ensureTags(data, tags);
    metaStore.write(data);
    res.status(201).json(entry);
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
