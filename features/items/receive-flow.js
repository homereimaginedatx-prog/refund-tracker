/* Fires when an item is marked "Received". Asks HOW the money came back:
   - Money back to card  -> done.
   - Store credit / gift card -> capture optional code + expiration; it becomes a tracked
     credit she still has to spend (shows in "Store credit to use"). */

import { el, toast, nowISO, centsToStr, todayISODate } from '../../core/ui.js';
import { openOverlay } from '../../core/overlay.js';
import { putItem } from '../../core/db.js';
import { STATUS, REFUND } from './model.js';

export function openReceiveFlow(item, onResolved) {
  const body = el('div', { class: 'form' });
  body.appendChild(el('h2', { class: 'sheet-title', text: 'Got it back! 🎉' }));
  body.appendChild(el('p', { class: 'receive-q', text: `How did the ${centsToStr(item.amount)} from ${item.payee || 'this'} come back?` }));

  const cashBtn = el('button', { class: 'choice-btn', html: '<span class="choice-emoji">💵</span><span>Money back<br><small>refunded to card / account</small></span>' });
  const creditBtn = el('button', { class: 'choice-btn', html: '<span class="choice-emoji">🎁</span><span>Store credit<br><small>gift card / store credit</small></span>' });
  body.appendChild(el('div', { class: 'choice-row' }, [cashBtn, creditBtn]));

  // Store-credit detail fields (revealed when "Store credit" is chosen)
  const codeInput = el('input', { type: 'text', class: 'input', placeholder: 'gift card / credit code (optional)' });
  const expInput = el('input', { type: 'date', class: 'input', min: todayISODate() });
  const saveCreditBtn = el('button', { class: 'btn btn-primary', text: 'Save store credit' });
  const creditWrap = el('div', { class: 'credit-fields hidden' }, [
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Code (optional)' }), codeInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Expires (optional)' }), expInput]),
    saveCreditBtn
  ]);
  body.appendChild(creditWrap);

  const overlay = openOverlay(body);

  cashBtn.addEventListener('click', () => resolve(REFUND.CASH));
  creditBtn.addEventListener('click', () => {
    creditBtn.classList.add('choice-on');
    cashBtn.classList.remove('choice-on');
    creditWrap.classList.remove('hidden');
    codeInput.focus();
  });
  saveCreditBtn.addEventListener('click', () => resolve(REFUND.CREDIT));

  async function resolve(method) {
    const updated = {
      ...item,
      status: STATUS.RECEIVED,
      refundMethod: method,
      creditUsed: false,
      creditCode: method === REFUND.CREDIT ? (codeInput.value.trim() || null) : null,
      creditExpires: method === REFUND.CREDIT ? (expInput.value || null) : null
    };
    if (item.status !== STATUS.RECEIVED) updated.statusChangedDate = nowISO();

    try {
      await putItem(updated);
      overlay.close();
      toast(method === REFUND.CREDIT ? 'Store credit saved — find it under “Store credit to use.”' : 'Marked received.');
      if (onResolved) await onResolved();
    } catch (err) {
      toast(err.message || 'Could not save — please try again.');
    }
  }
}
