/* Add / edit an item, including receipt photo capture.

   Save discipline (so items are never lost):
   - Validate first; on any error, show it inline and KEEP the sheet open with all input
     intact. Never close-and-lose.
   - Persist the receipt photo and the item, then re-read in the caller. The form reports
     success only after the DB write actually committed. */

import {
  el, clear, parseAmountToCents, centsToStr, todayISODate, toast, nowISO, uid
} from '../../core/ui.js';
import { openOverlay } from '../../core/overlay.js';
import { compressImage } from '../../core/images.js';
import { putItem, putReceipt, getReceipt, getMerchant, putMerchant } from '../../core/db.js';
import { getCategories, addCategory } from './categories.js';
import { getCards, addCard } from './cards.js';
import { openImageOverlay } from './receipt-view.js';
import {
  STATUS, TYPE, REFUND, statusLabel, makeItem, applyEdits, validateFields
} from './model.js';

const STATUS_CHOICES = [STATUS.NA, STATUS.PENDING, STATUS.RECEIVED, STATUS.CANCELLED];
const NEW_CATEGORY = '__new__';
const NEW_CARD = '__newcard__';

export async function openItemForm({ item = null, onSaved } = {}) {
  const editing = !!item;
  const categories = await getCategories();
  // Show a legacy/edited category even if it isn't in the saved list yet.
  if (item && item.category && !categories.includes(item.category)) categories.push(item.category);
  const cards = await getCards();
  if (item && item.card && !cards.includes(item.card)) cards.push(item.card);

  // Receipt working state (kept until Save).
  let pendingReceipt = null;
  let receiptRef = item ? item.receiptRef : null;
  let previewURL = null;

  const form = el('div', { class: 'form' });

  // --- Type ---
  let typeValue = item ? item.type : TYPE.RETURN;
  const typeReturn = el('button', { type: 'button', class: 'seg', text: 'Return', onClick: () => { typeValue = TYPE.RETURN; syncTypeUI(); } });
  const typeReimb = el('button', { type: 'button', class: 'seg', text: 'Reimbursement', onClick: () => { typeValue = TYPE.REIMBURSEMENT; syncTypeUI(); } });
  function syncTypeUI() {
    typeReturn.classList.toggle('seg-on', typeValue === TYPE.RETURN);
    typeReimb.classList.toggle('seg-on', typeValue === TYPE.REIMBURSEMENT);
  }

  // --- Payee ---
  const payeeInput = el('input', { type: 'text', class: 'input', placeholder: 'e.g. Amazon, Dr. Lee, Work', value: item ? item.payee : '', autocomplete: 'off' });
  const payeeErr = el('div', { class: 'field-err' });
  payeeInput.addEventListener('change', maybePrefillCategory);

  // --- Amount ---
  const amountInput = el('input', { type: 'text', class: 'input', inputmode: 'decimal', placeholder: '0.00', value: item ? centsToStr(item.amount).replace('$', '') : '' });
  const amountErr = el('div', { class: 'field-err' });

  // --- Date ---
  const dateInput = el('input', { type: 'date', class: 'input', value: item ? item.date : todayISODate() });

  // --- Expect it back by (optional) — drives in-app nudges + "Add to Calendar" ---
  const expectInput = el('input', { type: 'date', class: 'input', value: item && item.expectBy ? item.expectBy : '' });

  // --- Category (build-your-own pick list) ---
  const categorySelect = el('select', { class: 'input' });
  const newCatInput = el('input', { type: 'text', class: 'input', placeholder: 'Name your new category' });
  const newCatWrap = el('div', { class: 'sub-field hidden' }, [newCatInput]);

  function rebuildCategoryOptions(selected) {
    clear(categorySelect);
    categorySelect.appendChild(el('option', { value: '', text: '(none)' }));
    for (const c of categories) categorySelect.appendChild(el('option', { value: c, text: c }));
    categorySelect.appendChild(el('option', { value: NEW_CATEGORY, text: '➕ New category…' }));
    categorySelect.value = selected != null ? selected : '';
  }
  categorySelect.addEventListener('change', () => {
    const isNew = categorySelect.value === NEW_CATEGORY;
    newCatWrap.classList.toggle('hidden', !isNew);
    if (isNew) newCatInput.focus();
  });
  rebuildCategoryOptions(item && item.category ? item.category : '');

  async function maybePrefillCategory() {
    const v = categorySelect.value;
    if (v && v !== NEW_CATEGORY) return; // don't overwrite a chosen category
    const m = await getMerchant(payeeInput.value.trim());
    if (m && m.lastCategory) {
      if (!categories.includes(m.lastCategory)) categories.push(m.lastCategory);
      rebuildCategoryOptions(m.lastCategory);
    }
  }

  // --- Card it's coming back to (build-your-own, same pattern as category) ---
  const cardSelect = el('select', { class: 'input' });
  const newCardInput = el('input', { type: 'text', class: 'input', placeholder: 'Name your card (e.g. Chase Sapphire)' });
  const newCardWrap = el('div', { class: 'sub-field hidden' }, [newCardInput]);
  function rebuildCardOptions(selected) {
    clear(cardSelect);
    cardSelect.appendChild(el('option', { value: '', text: '(none)' }));
    for (const c of cards) cardSelect.appendChild(el('option', { value: c, text: c }));
    cardSelect.appendChild(el('option', { value: NEW_CARD, text: '➕ New card…' }));
    cardSelect.value = selected != null ? selected : '';
  }
  cardSelect.addEventListener('change', () => {
    const isNew = cardSelect.value === NEW_CARD;
    newCardWrap.classList.toggle('hidden', !isNew);
    if (isNew) newCardInput.focus();
  });
  rebuildCardOptions(item && item.card ? item.card : '');

  // --- Reference # (optional, off by default) ---
  const refToggle = el('input', { type: 'checkbox' });
  refToggle.checked = !!(item && item.reference);
  const refInput = el('input', { type: 'text', class: 'input', placeholder: 'order # / RMA / confirmation #', value: item && item.reference ? item.reference : '' });
  const refWrap = el('div', { class: 'sub-field' + (refToggle.checked ? '' : ' hidden') }, [refInput]);
  const refRow = el('label', { class: 'check-row' }, [refToggle, el('span', { text: 'Add a reference # (order / RMA)' })]);
  refToggle.addEventListener('change', () => {
    refWrap.classList.toggle('hidden', !refToggle.checked);
    if (refToggle.checked) refInput.focus();
  });

  // --- Note ---
  const noteInput = el('textarea', { class: 'input textarea', rows: '2', placeholder: 'optional note / what it was for', value: item && item.purpose ? item.purpose : '' });

  // --- Status ---
  const statusSelect = el('select', { class: 'input' }, STATUS_CHOICES.map((s) => el('option', { value: s, text: statusLabel(s, typeValue) })));
  statusSelect.value = item ? item.status : STATUS.NA;

  // --- Refund method + store-credit details (relevant once received) ---
  const methodSelect = el('select', { class: 'input' }, [
    el('option', { value: '', text: '—' }),
    el('option', { value: REFUND.CASH, text: 'Money back to card' }),
    el('option', { value: REFUND.CREDIT, text: 'Store credit / gift card' })
  ]);
  methodSelect.value = item && item.refundMethod ? item.refundMethod : '';
  const creditCodeInput = el('input', { type: 'text', class: 'input', placeholder: 'gift card / credit code', value: item && item.creditCode ? item.creditCode : '' });
  const creditExpInput = el('input', { type: 'date', class: 'input', value: item && item.creditExpires ? item.creditExpires : '' });
  const creditUsedInput = el('input', { type: 'checkbox' });
  creditUsedInput.checked = !!(item && item.creditUsed);
  const creditBox = el('div', { class: 'sub-field' + (methodSelect.value === REFUND.CREDIT ? '' : ' hidden') }, [
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Code' }), creditCodeInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field-label', text: 'Expires' }), creditExpInput]),
    el('label', { class: 'check-row' }, [creditUsedInput, el('span', { text: 'Already used' })])
  ]);
  methodSelect.addEventListener('change', () => creditBox.classList.toggle('hidden', methodSelect.value !== REFUND.CREDIT));

  // --- Receipt ---
  const fileInput = el('input', { type: 'file', accept: 'image/*', class: 'hidden-file' });
  const thumb = el('div', { class: 'receipt-thumb' });
  const addReceiptBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: '📷  Add receipt photo', onClick: () => fileInput.click() });
  const receiptArea = el('div', { class: 'receipt-area' }, [addReceiptBtn, thumb, fileInput]);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    addReceiptBtn.disabled = true; addReceiptBtn.textContent = 'Processing…';
    try {
      pendingReceipt = await compressImage(file);
      receiptRef = receiptRef || uid();
      showThumb(URL.createObjectURL(pendingReceipt.blob));
    } catch (err) {
      toast(err.message || 'Could not add that photo.');
    } finally {
      addReceiptBtn.disabled = false; addReceiptBtn.textContent = '📷  Replace receipt photo'; fileInput.value = '';
    }
  });

  function showThumb(url) {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = url;
    clear(thumb);
    const img = el('img', { src: url, alt: 'receipt preview', title: 'Tap to view full size' });
    img.addEventListener('click', () => openImageOverlay(url)); // form owns the URL; don't revoke here
    thumb.appendChild(img);
    thumb.appendChild(el('div', { class: 'thumb-hint', text: 'Tap the photo to view it full size' }));
    thumb.appendChild(el('button', {
      type: 'button', class: 'btn btn-small btn-ghost', text: 'Remove',
      onClick: () => {
        pendingReceipt = null; receiptRef = null;
        if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = null; }
        clear(thumb);
        addReceiptBtn.textContent = '📷  Add receipt photo';
      }
    }));
  }

  if (editing && receiptRef) {
    getReceipt(receiptRef).then((r) => {
      if (r && r.blob) { showThumb(URL.createObjectURL(r.blob)); addReceiptBtn.textContent = '📷  Replace receipt photo'; }
    }).catch(() => {});
  }

  // --- Assemble ---
  form.appendChild(el('h2', { class: 'sheet-title', text: editing ? 'Edit item' : 'Add item' }));
  form.appendChild(field('Type', el('div', { class: 'segmented' }, [typeReturn, typeReimb])));
  form.appendChild(field('Who / where', payeeInput, payeeErr));
  form.appendChild(field('Amount', amountWrap(amountInput), amountErr));
  form.appendChild(field('Date', dateInput));
  form.appendChild(field('Expect it back by (optional)', expectInput,
    el('div', { class: 'field-hint', text: 'We’ll remind you in the app, and you can add it to your iPhone calendar.' })));
  form.appendChild(field('Category', categorySelect));
  form.appendChild(newCatWrap);
  form.appendChild(field('Card it’s coming back to', cardSelect,
    el('div', { class: 'field-hint', text: 'So you know which card to check when the refund posts.' })));
  form.appendChild(newCardWrap);
  form.appendChild(refRow);
  form.appendChild(refWrap);
  form.appendChild(field('Note', noteInput));
  form.appendChild(field('Status', statusSelect));
  form.appendChild(field('How you got it back', methodSelect));
  form.appendChild(creditBox);
  form.appendChild(field('Receipt', receiptArea));

  const saveBtn = el('button', { class: 'btn btn-primary', text: editing ? 'Save changes' : 'Add item' });
  const cancelBtn = el('button', { class: 'btn btn-ghost', text: 'Cancel', onClick: () => overlay.close() });
  form.appendChild(el('div', { class: 'sheet-footer' }, [cancelBtn, saveBtn]));

  syncTypeUI();
  const overlay = openOverlay(form, { onClose: () => { if (previewURL) URL.revokeObjectURL(previewURL); } });

  saveBtn.addEventListener('click', async () => {
    payeeErr.textContent = ''; amountErr.textContent = '';
    const v = validateFields({ payee: payeeInput.value, amountText: amountInput.value });
    const cents = parseAmountToCents(amountInput.value);
    if (cents == null) v.errors.amount = 'Enter a valid amount like 24.99';
    else if (cents <= 0) v.errors.amount = 'Amount must be more than zero.';
    if (Object.keys(v.errors).length) {
      if (v.errors.payee) payeeErr.textContent = v.errors.payee;
      if (v.errors.amount) amountErr.textContent = v.errors.amount;
      return;
    }

    // resolve category (existing pick, brand-new, or none)
    let category = null;
    if (categorySelect.value === NEW_CATEGORY) category = newCatInput.value.trim() || null;
    else if (categorySelect.value) category = categorySelect.value;

    // resolve card (existing pick, brand-new, or none)
    let card = null;
    if (cardSelect.value === NEW_CARD) card = newCardInput.value.trim() || null;
    else if (cardSelect.value) card = cardSelect.value;

    const reference = refToggle.checked && refInput.value.trim() ? refInput.value.trim() : null;

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      if (category) await addCategory(category); // persist user's taxonomy
      if (card) await addCard(card);             // persist user's card list

      const fields = {
        date: dateInput.value, payee: payeeInput.value, amount: cents, type: typeValue,
        category, card, reference, expectBy: expectInput.value || null,
        purpose: noteInput.value, status: statusSelect.value, receiptRef,
        refundMethod: methodSelect.value || null,
        creditCode: methodSelect.value === REFUND.CREDIT ? creditCodeInput.value : null,
        creditExpires: methodSelect.value === REFUND.CREDIT ? (creditExpInput.value || null) : null,
        creditUsed: methodSelect.value === REFUND.CREDIT ? creditUsedInput.checked : false
      };

      if (pendingReceipt) {
        await putReceipt({ id: receiptRef, blob: pendingReceipt.blob, width: pendingReceipt.width, height: pendingReceipt.height, createdAt: nowISO() });
      }

      const record = editing ? applyEdits(item, fields) : makeItem(fields);
      await putItem(record);

      if (record.category) await putMerchant({ payee: record.payee, lastCategory: record.category, updatedAt: nowISO() });

      overlay.close();
      toast(editing ? 'Saved.' : 'Item added.');
      if (onSaved) await onSaved();
    } catch (err) {
      saveBtn.disabled = false; saveBtn.textContent = editing ? 'Save changes' : 'Add item';
      toast(err.message || 'Could not save — nothing was lost, please try again.', { duration: 6000 });
    }
  });
}

// ---- small builders --------------------------------------------------------

function field(label, control, errNode) {
  const f = el('label', { class: 'field' }, [el('span', { class: 'field-label', text: label }), control]);
  if (errNode) f.appendChild(errNode);
  return f;
}

function amountWrap(input) {
  return el('div', { class: 'amount-wrap' }, [el('span', { class: 'amount-prefix', text: '$' }), input]);
}
