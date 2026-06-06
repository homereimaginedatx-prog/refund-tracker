/* Pure data model + logic for the items feature. No DOM here, so it is fully unit-testable
   (see tests.html). This is where the integrity guarantees live as plain functions. */

import { uid, nowISO, todayISODate } from '../../core/ui.js';

export const STATUS = Object.freeze({
  NA: 'na',           // still on the user: needs to be returned / submitted
  PENDING: 'pending', // waiting on the money to come back
  RECEIVED: 'received', // done — money received
  CANCELLED: 'cancelled' // closed without money (soft delete; never removed)
});

export const TYPE = Object.freeze({
  RETURN: 'retail-return',
  REIMBURSEMENT: 'reimbursement-owed'
});

export const STATUS_ORDER = [STATUS.NA, STATUS.PENDING, STATUS.RECEIVED, STATUS.CANCELLED];

/** A status counts as "outstanding" (money still owed to the user) when NA or PENDING. */
export function isOutstanding(status) {
  return status === STATUS.NA || status === STATUS.PENDING;
}

export function typeLabel(type) {
  return type === TYPE.REIMBURSEMENT ? 'Reimbursement' : 'Return';
}

/** Status labels are phrased to the type so they read naturally. */
export function statusLabel(status, type) {
  const reimb = type === TYPE.REIMBURSEMENT;
  switch (status) {
    case STATUS.NA: return reimb ? 'To submit' : 'To return';
    case STATUS.PENDING: return reimb ? 'Awaiting reimbursement' : 'Awaiting refund';
    case STATUS.RECEIVED: return 'Received';
    case STATUS.CANCELLED: return 'Cancelled';
    default: return status;
  }
}

export function statusGroupLabel(status) {
  switch (status) {
    case STATUS.NA: return 'To do';
    case STATUS.PENDING: return 'Awaiting money';
    case STATUS.RECEIVED: return 'Received';
    case STATUS.CANCELLED: return 'Cancelled';
    default: return status;
  }
}

/** Quick next-step actions offered on a card, by current status. */
export function quickActions(status) {
  switch (status) {
    case STATUS.NA: return [
      { label: 'Awaiting', to: STATUS.PENDING },
      { label: 'Received', to: STATUS.RECEIVED, primary: true }
    ];
    case STATUS.PENDING: return [
      { label: 'Mark received', to: STATUS.RECEIVED, primary: true }
    ];
    case STATUS.RECEIVED: return [
      { label: 'Reopen', to: STATUS.PENDING }
    ];
    case STATUS.CANCELLED: return [
      { label: 'Restore', to: STATUS.NA }
    ];
    default: return [];
  }
}

/** Build a normalized new item from form fields. Stamps id + timestamps. */
export function makeItem(fields) {
  const created = nowISO();
  return {
    id: uid(),
    date: fields.date || todayISODate(),
    payee: (fields.payee || '').trim(),
    amount: fields.amount | 0,            // integer cents
    type: fields.type || TYPE.RETURN,
    category: fields.category ? fields.category.trim() : null,
    purpose: fields.purpose ? fields.purpose.trim() : null,
    receiptRef: fields.receiptRef || null,
    status: fields.status || STATUS.NA,
    statusChangedDate: created,
    createdDate: created
  };
}

/** Apply edited fields to an existing item, preserving id/createdDate.
    statusChangedDate only moves when the status actually changes. */
export function applyEdits(existing, fields) {
  const statusChanged = fields.status && fields.status !== existing.status;
  return {
    ...existing,
    date: fields.date || existing.date,
    payee: (fields.payee || '').trim(),
    amount: fields.amount | 0,
    type: fields.type || existing.type,
    category: fields.category ? fields.category.trim() : null,
    purpose: fields.purpose ? fields.purpose.trim() : null,
    receiptRef: fields.receiptRef !== undefined ? fields.receiptRef : existing.receiptRef,
    status: fields.status || existing.status,
    statusChangedDate: statusChanged ? nowISO() : existing.statusChangedDate
  };
}

/** Return a copy with a new status + fresh statusChangedDate. */
export function withStatus(item, status) {
  if (item.status === status) return item;
  return { ...item, status, statusChangedDate: nowISO() };
}

/** Validate form fields. Returns { ok, errors:{field:msg}, amount } — never throws. */
export function validateFields({ payee, amountText }) {
  const errors = {};
  if (!payee || !payee.trim()) errors.payee = 'Who is this with?';
  // amount parsing is done by the caller (ui.parseAmountToCents); we just check presence here
  if (amountText == null || String(amountText).trim() === '') errors.amount = 'Enter an amount.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ----- THE integrity-critical computation -----
   The dashboard totals are ALWAYS this pure function of the full item list, recomputed
   from scratch. There is no separate stored tally that could drift. Every item lands in
   exactly one status bucket, so nothing can silently disappear. */
export function computeSummary(items) {
  const out = {
    total: items.length,
    outstandingCents: 0, outstandingCount: 0,
    receivedCents: 0, receivedCount: 0,
    cancelledCount: 0,
    byStatus: { [STATUS.NA]: [], [STATUS.PENDING]: [], [STATUS.RECEIVED]: [], [STATUS.CANCELLED]: [] }
  };
  for (const it of items) {
    const bucket = out.byStatus[it.status] || (out.byStatus[it.status] = []);
    bucket.push(it);
    if (isOutstanding(it.status)) {
      out.outstandingCents += it.amount | 0;
      out.outstandingCount += 1;
    } else if (it.status === STATUS.RECEIVED) {
      out.receivedCents += it.amount | 0;
      out.receivedCount += 1;
    } else if (it.status === STATUS.CANCELLED) {
      out.cancelledCount += 1;
    }
  }
  return out;
}

/** Reconciliation check used by tests + the UI: every item is accounted for exactly once. */
export function reconciles(items, summary) {
  return summary.total === (summary.outstandingCount + summary.receivedCount + summary.cancelledCount);
}
