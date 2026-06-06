/* A self-contained photo capture + preview control. One trustworthy code path reused by:
   - the edit form's purchase receipt,
   - the edit form's drop-off / tracking photo,
   - the in-field "Return started" flow.

   The control owns its own working state until the caller commits it. persist() writes any
   newly-picked photo to the receipts store (atomic) and returns the ref; call it inside the
   caller's save sequence so a photo is only stored when the item is actually saved. */

import { el, clear, toast, nowISO, uid } from '../../core/ui.js';
import { compressImage } from '../../core/images.js';
import { putReceipt, getReceipt } from '../../core/db.js';
import { openImageOverlay } from './receipt-view.js';

export function makeReceiptSlot({
  initialRef = null,
  addText = '📷  Add photo',
  replaceText = '📷  Replace photo',
  editing = false
} = {}) {
  let pending = null;        // compressed { blob, width, height } awaiting save
  let ref = initialRef || null;
  let url = null;            // object URL for the live preview (owned here)

  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file' });
  const thumb = el('div', { class: 'receipt-thumb' });
  const addBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: addText, onClick: () => fileInput.click() });
  const node = el('div', { class: 'receipt-area' }, [addBtn, thumb, fileInput]);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    addBtn.disabled = true; addBtn.textContent = 'Processing…';
    try {
      pending = await compressImage(file);
      ref = ref || uid();
      showThumb(URL.createObjectURL(pending.blob));
    } catch (err) {
      toast(err.message || 'Could not add that photo.');
    } finally {
      addBtn.disabled = false; addBtn.textContent = replaceText; fileInput.value = '';
    }
  });

  function showThumb(u) {
    if (url) URL.revokeObjectURL(url);
    url = u;
    clear(thumb);
    const img = el('img', { src: u, alt: 'photo preview', title: 'Tap to view full size' });
    img.addEventListener('click', () => openImageOverlay(u)); // slot owns the URL; viewer won't revoke
    thumb.appendChild(img);
    thumb.appendChild(el('div', { class: 'thumb-hint', text: 'Tap the photo to view it full size' }));
    thumb.appendChild(el('button', {
      type: 'button', class: 'btn btn-small btn-ghost', text: 'Remove',
      onClick: () => {
        pending = null; ref = null;
        if (url) { URL.revokeObjectURL(url); url = null; }
        clear(thumb);
        addBtn.textContent = addText;
      }
    }));
  }

  if (editing && ref) {
    getReceipt(ref).then((r) => {
      if (r && r.blob) { showThumb(URL.createObjectURL(r.blob)); addBtn.textContent = replaceText; }
    }).catch(() => {});
  }

  /** Commit a newly-picked photo to the receipts store; return the ref (or null). */
  async function persist() {
    if (pending) {
      await putReceipt({ id: ref, blob: pending.blob, width: pending.width, height: pending.height, createdAt: nowISO() });
      pending = null;
    }
    return ref;
  }

  return {
    node,
    getState: () => ({ pending, ref }),
    persist,
    cleanup: () => { if (url) URL.revokeObjectURL(url); }
  };
}
