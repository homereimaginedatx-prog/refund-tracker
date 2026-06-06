/* Add / edit an item, including receipt photo capture.

   Save discipline (so items are never lost):
   - Validate first; on any error, show it inline and KEEP the sheet open with all input
     intact. Never close-and-lose.
   - Persist the receipt photo and the item, then re-read in the caller. The form reports
     success only after the DB write actually committed. */

import {
  el, clear, parseAmountToCents, centsToStr, todayISODate, toast
} from '../../core/ui.js';
import { openOverlay } from '../../core/overlay.js';
import { compressImage } from '../../core/images.js';
import {
  putItem, putReceipt, getReceipt, getMerchant, putMerchant, getAllMerchants
} from '../../core/db.js';
import { nowISO, uid } from '../../core/ui.js';
import {
  STATUS, TYPE, statusLabel, typeLabel, makeItem, applyEdits, validateFields
} from './model.js';

const STATUS_CHOICES = [STATUS.NA, STATUS.PENDING, STATUS.RECEIVED, STATUS.CANCELLED];

export async function openItemForm({ item = null, onSaved } = {}) {
  const editing = !!item;
  const knownCategories = await collectCategories();

  // Working state for the receipt (kept until Save).
  let pendingReceipt = null;       // { blob, width, height } for a newly captured photo
  let receiptRef = item ? item.receiptRef : null;
  let previewURL = null;

  const form = el('div', { class: 'form' });

  // --- Type ---
  const typeReturn = typeBtn('Return', TYPE.RETURN);
  const typeReimb = typeBtn('Reimbursement', TYPE.REIMBURSEMENT);
  let typeValue = item ? item.type : TYPE.RETURN;
  function typeBtn(label, value) {
    return el('button', {
      type: 'button', class: 'seg', text: label,
      onClick: () => { typeValue = value; syncTypeUI(); }
    });
  }
  function syncTypeUI() {
    typeReturn.classList.toggle('seg-on', typeValue === TYPE.RETURN);
    typeReimb.classList.toggle('seg-on', typeValue === TYPE.REIMBURSEMENT);
  }
  const typeRow = field('Type', el('div', { class: 'segmented' }, [typeReturn, typeReimb]));

  // --- Payee ---
  const payeeInput = el('input', {
    type: 'text', class: 'input', placeholder: 'e.g. Amazon, Dr. Lee, Work',
    value: item ? item.payee : '', autocomplete: 'off'
  });
  const payeeErr = el('div', { class: 'field-err' });
  payeeInput.addEventListener('change', maybePrefillCategory);

  // --- Amount ---
  const amountInput = el('input', {
    type: 'text', class: 'input', inputmode: 'decimal', placeholder: '0.00',
    value: item ? (centsToStr(item.amount).replace('$', '')) : ''
  });
  const amountErr = el('div', { class: 'field-err' });

  // --- Date ---
  const dateInput = el('input', {
    type: 'date', class: 'input', value: item ? item.date : todayISODate()
  });

  // --- Category (with suggestions) ---
  const catListId = 'cats-' + uid().slice(0, 8);
  const datalist = el('datalist', { id: catListId },
    knownCategories.map((c) => el('option', { value: c })));
  const categoryInput = el('input', {
    type: 'text', class: 'input', placeholder: 'optional', list: catListId,
    value: item && item.category ? item.category : '', autocomplete: 'off'
  });

  async function maybePrefillCategory() {
    if (categoryInput.value.trim()) return;
    const m = await getMerchant(payeeInput.value.trim());
    if (m && m.lastCategory) categoryInput.value = m.lastCategory;
  }

  // --- Note ---
  const noteInput = el('textarea', {
    class: 'input textarea', rows: '2', placeholder: 'optional note / what it was for',
    value: item && item.purpose ? item.purpose : ''
  });

  // --- Status ---
  const statusSelect = el('select', { class: 'input' },
    STATUS_CHOICES.map((s) => el('option', { value: s, text: statusLabel(s, typeValue) })));
  statusSelect.value = item ? item.status : STATUS.NA;

  // --- Receipt ---
  const fileInput = el('input', {
    type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden-file'
  });
  const thumb = el('div', { class: 'receipt-thumb' });
  const addReceiptBtn = el('button', {
    type: 'button', class: 'btn btn-ghost', text: '📷  Add receipt photo',
    onClick: () => fileInput.click()
  });
  const receiptArea = el('div', { class: 'receipt-area' }, [addReceiptBtn, thumb, fileInput]);

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    addReceiptBtn.disabled = true;
    addReceiptBtn.textContent = 'Processing…';
    try {
      pendingReceipt = await compressImage(file);
      receiptRef = receiptRef || uid();
      showThumb(URL.createObjectURL(pendingReceipt.blob));
    } catch (err) {
      toast(err.message || 'Could not add that photo.');
    } finally {
      addReceiptBtn.disabled = false;
      addReceiptBtn.textContent = '📷  Replace receipt photo';
      fileInput.value = '';
    }
  });

  function showThumb(url) {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = url;
    clear(thumb);
    thumb.appendChild(el('img', { src: url, alt: 'receipt preview' }));
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

  // Show existing receipt when editing.
  if (editing && receiptRef) {
    getReceipt(receiptRef).then((r) => {
      if (r && r.blob) { showThumb(URL.createObjectURL(r.blob)); addReceiptBtn.textContent = '📷  Replace receipt photo'; }
    }).catch(() => {});
  }

  // --- Assemble ---
  form.appendChild(el('h2', { class: 'sheet-title', text: editing ? 'Edit item' : 'Add item' }));
  form.appendChild(typeRow);
  form.appendChild(field('Who / where', payeeInput, payeeErr));
  form.appendChild(field('Amount', amountWrap(amountInput), amountErr));
  form.appendChild(field('Date', dateInput));
  form.appendChild(field('Category', categoryInput));
  form.appendChild(field('Note', noteInput));
  form.appendChild(field('Status', statusSelect));
  form.appendChild(field('Receipt', receiptArea));
  form.appendChild(datalist);

  const saveBtn = el('button', { class: 'btn btn-primary', text: editing ? 'Save changes' : 'Add item' });
  const cancelBtn = el('button', { class: 'btn btn-ghost', text: 'Cancel', onClick: () => overlay.close() });
  const footer = el('div', { class: 'sheet-footer' }, [cancelBtn, saveBtn]);
  form.appendChild(footer);

  syncTypeUI();
  const overlay = openOverlay(form, { onClose: () => { if (previewURL) URL.revokeObjectURL(previewURL); } });

  saveBtn.addEventListener('click', async () => {
    payeeErr.textContent = ''; amountErr.textContent = '';
    const v = validateFields({ payee: payeeInput.value, amountText: amountInput.value });
    const cents = parseAmountToCents(amountInput.value);
    if (cents == null) v.errors.amount = 'Enter a valid amount like 24.99';
    if (cents != null && cents <= 0) v.errors.amount = 'Amount must be more than zero.';
    if (Object.keys(v.errors).length) {
      if (v.errors.payee) payeeErr.textContent = v.errors.payee;
      if (v.errors.amount) amountErr.textContent = v.errors.amount;
      return; // keep sheet + input
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const fields = {
        date: dateInput.value, payee: payeeInput.value, amount: cents, type: typeValue,
        category: categoryInput.value, purpose: noteInput.value, status: statusSelect.value,
        receiptRef
      };

      if (pendingReceipt) {
        await putReceipt({
          id: receiptRef, blob: pendingReceipt.blob,
          width: pendingReceipt.width, height: pendingReceipt.height, createdAt: nowISO()
        });
      }

      const record = editing ? applyEdits(item, fields) : makeItem(fields);
      await putItem(record);

      if (record.category) {
        await putMerchant({ payee: record.payee, lastCategory: record.category, updatedAt: nowISO() });
      }

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
  const f = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control
  ]);
  if (errNode) f.appendChild(errNode);
  return f;
}

function amountWrap(input) {
  return el('div', { class: 'amount-wrap' }, [el('span', { class: 'amount-prefix', text: '$' }), input]);
}

async function collectCategories() {
  try {
    const merchants = await getAllMerchants();
    return [...new Set(merchants.map((m) => m.lastCategory).filter(Boolean))].sort();
  } catch {
    return [];
  }
}
