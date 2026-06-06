/* The in-field "Return started" flow — the fast, one-handed step she does at the UPS/store
   counter. Deliberately minimal: snap the tracking/drop-off photo, confirm the expected-back
   date (pre-filled from what she set at home), optionally fire the calendar reminder, Save.

   Save moves the item To do → Waiting and returns her to the list with the next item ready.
   Cancel changes NOTHING — the item stays in To do — because the status only moves on Save. */

import { el, toast, nowISO, centsToStr } from '../../core/ui.js';
import { openOverlay } from '../../core/overlay.js';
import { putItem } from '../../core/db.js';
import { makeReceiptSlot } from './receipt-slot.js';
import { addToCalendar } from './calendar.js';
import { STATUS, withStatus } from './model.js';

export function openReturnFlow(item, onResolved) {
  const slot = makeReceiptSlot({
    initialRef: item.trackingRef || null,
    addText: '📷  Snap the tracking label / receipt',
    replaceText: '📷  Replace photo',
    editing: !!item.trackingRef
  });

  const expectInput = el('input', { type: 'date', class: 'input', value: item.expectBy || '' });

  async function addCal() {
    if (!expectInput.value) { toast('Pick an expected-back date first.'); return; }
    try {
      const r = await addToCalendar({ ...item, expectBy: expectInput.value }, { dtstamp: nowISO() });
      if (r.ok && (r.reason === 'opened' || r.reason === 'shared')) toast('Opening Calendar — choose a calendar and tap Add.', { duration: 6000 });
      else if (r.ok && r.reason === 'downloaded') toast('Saved the calendar file — tap it to add the reminder.', { duration: 6000 });
      else if (r.reason !== 'cancelled') toast('Could not create the reminder.');
    } catch (e) { toast(e.message || 'Could not create the reminder.'); }
  }
  const calBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block', text: '📅  Add reminder to Calendar', onClick: addCal });

  const saveBtn = el('button', { class: 'btn btn-primary', text: 'Save & next' });
  const cancelBtn = el('button', { class: 'btn btn-ghost', text: 'Cancel', onClick: () => ov.close() });

  const body = el('div', { class: 'form return-flow' }, [
    el('h2', { class: 'sheet-title', text: '📦 Return started' }),
    el('div', { class: 'return-sub', text: `${item.payee || '(no name)'} · ${centsToStr(item.amount)}${item.reference ? ' · #' + item.reference : ''}` }),
    field('Tracking / drop-off photo', slot.node),
    field('Expected back by', expectInput),
    el('div', { class: 'return-cal' }, [calBtn]),
    el('div', { class: 'sheet-footer' }, [cancelBtn, saveBtn])
  ]);

  const ov = openOverlay(body, { onClose: () => slot.cleanup() });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const trackingRef = await slot.persist();
      // Move To do → Waiting, preserving every other field. (Don't use applyEdits here —
      // it expects the full form and would blank category/note.)
      const updated = { ...withStatus(item, STATUS.PENDING) };
      updated.expectBy = expectInput.value || null;
      updated.trackingRef = trackingRef;
      await putItem(updated);
      ov.close();
      toast('Marked as returned — now waiting on the refund.');
      if (onResolved) await onResolved();
    } catch (e) {
      saveBtn.disabled = false; saveBtn.textContent = 'Save & next';
      toast(e.message || 'Could not save — please try again.', { duration: 6000 });
    }
  });

  function field(label, control) {
    return el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]);
  }
}
