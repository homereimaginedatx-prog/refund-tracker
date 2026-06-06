/* Receipt photo handling.

   A raw iPad camera photo is several MB. We downscale + re-encode to JPEG before storing,
   which (a) keeps the on-device database small (less storage-pressure eviction risk) and
   (b) strips HEIC and bakes in the correct EXIF orientation so receipts aren't sideways.

   Returns { blob, width, height }. Stores nothing itself — the caller saves the Blob. */

const MAX_EDGE = 1600;
const QUALITY = 0.7;

export async function compressImage(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const { bitmap, width: srcW, height: srcH } = await loadBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();

  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (!blob) throw new Error('Could not process that photo. Please try again.');
  return { blob, width, height };
}

async function loadBitmap(file) {
  // Preferred path: createImageBitmap with EXIF orientation applied.
  if ('createImageBitmap' in globalThis) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      try {
        const bitmap = await createImageBitmap(file);
        return { bitmap, width: bitmap.width, height: bitmap.height };
      } catch { /* fall through to <img> */ }
    }
  }
  // Fallback: load via an <img> element from an object URL.
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image file.'));
      i.src = url;
    });
    return { bitmap: img, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(width, height); } catch { /* fall through */ }
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality }); // OffscreenCanvas
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
