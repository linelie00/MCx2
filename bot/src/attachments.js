/**
 * attachments — 디스코드 첨부를 사이트로 다시 올리기 위한 준비
 *
 * 사이트 API 에는 "URL 로 등록" 경로가 없다. 그래서 디스코드 CDN 에서 바이트를 받아
 * multipart 로 다시 올리는 수밖에 없다.
 *
 * 첨부 URL 은 서명·만료된다(ex/is/hm 파라미터). 인터랙션을 처리하는 그 자리에서 바로
 * 받아야 하고, URL 을 저장해 뒀다가 나중에 받는 설계는 절대 하면 안 된다.
 */

/** 서버가 받는 종류 (galleryController / movieController 기준) */
const IMAGE = /^image\/(png|jpe?g|gif|webp)$/i;
const VIDEO = /^video\/(mp4|quicktime|webm)$/i;

export const isImage = (att) => IMAGE.test(att?.contentType || '');
export const isVideo = (att) => VIDEO.test(att?.contentType || '');

/** 사람이 읽는 크기. 실패 안내에 쓴다. */
export const humanSize = (bytes) => {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
};

/**
 * 첨부 하나를 Blob 으로 받아온다.
 * 실패는 그대로 던진다 — 어떤 파일이 문제인지 호출부에서 이름과 함께 알린다.
 */
export async function toBlob(attachment) {
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`디스코드에서 파일을 받지 못했어요 (${res.status})`);
  return res.blob();
}

/**
 * 여러 첨부를 FormData 에 같은 필드명으로 담는다.
 * 갤러리 업로드가 files 를 반복해서 받기 때문에 이 형태가 필요하다.
 */
export async function appendAll(form, field, attachments) {
  for (const att of attachments) {
    form.append(field, await toBlob(att), att.name);
  }
  return form;
}

export default { isImage, isVideo, humanSize, toBlob, appendAll };
