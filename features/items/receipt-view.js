/* View a receipt photo full-size. Previously the only receipt affordance was "add/replace"
   in the edit form, so there was no way to actually look at a photo you'd already saved.
   This opens the stored image in a modal. Used by the register cards (tap "View receipt")
   and by the edit form (tap the thumbnail). */

import { el, toast } from '../../core/ui.js';
import { openOverlay } from '../../core/overlay.js';
import { getReceipt } from '../../core/db.js';

/** Show an image (object URL or data URL) full-size in a modal. Caller owns URL cleanup
    via onClose if it created an object URL. */
export function openImageOverlay(src, { onClose } = {}) {
  const img = el('img', { class: 'receipt-full', src, alt: 'Receipt photo' });
  const wrap = el('div', { class: 'receipt-viewer' }, [
    img,
    el('button', { class: 'btn btn-ghost', text: 'Close', onClick: () => ov.close() })
  ]);
  const ov = openOverlay(wrap, { onClose });
  return ov;
}

/** Load a stored receipt by ref and show it full-size. Revokes its object URL on close. */
export async function openReceiptViewer(receiptRef) {
  if (!receiptRef) { toast('No receipt photo on this item.'); return; }
  try {
    const r = await getReceipt(receiptRef);
    if (!r || !r.blob) { toast('Receipt photo not found.'); return; }
    const url = URL.createObjectURL(r.blob);
    openImageOverlay(url, { onClose: () => URL.revokeObjectURL(url) });
  } catch (e) {
    toast(e.message || 'Could not open the receipt.');
  }
}
