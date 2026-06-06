/* Pure data model + logic for the items feature. No DOM here, so it is fully unit-testable
   (see tests.html). This is where the integrity guarantees live as plain functions. */

import { uid, nowISO, todayISODate } from '../../core/ui.js';

export const STATUS = Object.freeze({
  NA: 'na',           // still on the user: needs to be returned / submitted
  PENDING: 'pending', // waiting on the money to come back
  RECEIVED: 'received', // done — money or store credit received
  CANCELLED: 'cancelled' // closed without money (soft delete; never removed)
});

export const TYPE = Object.freeze({
  RETURN: 'retail-return',
  REIMBURSEMENT: 'reimbursement-owed'
});

/** How the money came back, recorded when an item is marked Received. */
export const REFUND = Object.freeze({
  CASH: 'cash',     // money back to card / account — fully done
  CREDIT: 'credit'  // store credit / gift card — value she still has to spend
});

export const STATUS_ORDER = [STATUS.NA, STATUS.PENDING, STATUS.RECEIVED, STATUS.CANCELLED];

/** A status counts as "outstanding" (money still owed to the user) when NA or PENDING. */
export function isOutstanding(status) {
  return status === STATUS.NA || status === STATUS.PENDING;
}

/** A received item that is store credit and not yet spent — money she still holds. */
export function isStoreCredit(item) {
  return item.status === STATUS.RECEIVED && item.refundMethod === REFUND.CREDIT && !item.creditUsed;
}

export function typeLabel(type) {
  return type === TYPE.REIMBURSEMENT ? 'Reimbursement' : 'Return';
}

/** Status labels phrased to the type so they read naturally. */
export function statusLabel(status, type) {
  const reimb = type === TYPE.REIMBURSEMENT;
  switch (status) {
    case STATUS.NA: return reimb ? 'Need to submit' : 'Need to return';
    case STATUS.PENDING: return reimb ? 'Waiting on reimbursement' : 'Waiting on refund';
    case STATUS.RECEIVED: return 'Received';
    case STATUS.CANCELLED: return 'Cancelled';
    default: return status;
  }
}

/* ----- View grouping -----
   The register groups by a derived "view group", not raw status, so unspent store credits
   surface in their own section instead of being buried in Received. */
export const VIEW_ORDER = ['todo', 'waiting', 'credit', 'received', 'cancelled'];

export function getViewGroup(item) {
  if (item.status === STATUS.CANCELLED) return 'cancelled';
  if (item.status === STATUS.NA) return 'todo';
  if (item.status === STATUS.PENDING) return 'waiting';
  if (isStoreCredit(item)) return 'credit';
  return 'received';
}

export function viewGroupLabel(group) {
  return {
    todo: 'To do', waiting: 'Waiting on money', credit: 'Store credit to use',
    received: 'Received', cancelled: 'Cancelled'
  }[group] || group;
}

/** Quick next-step actions (kept for reference/tests; the card uses a tappable stepper). */
export function quickActions(status) {
  switch (status) {
    case STATUS.NA: return [
      { label: 'Awaiting', to: STATUS.PENDING },
      { label: 'Received', to: STATUS.RECEIVED, primary: true }
    ];
    case STATUS.PENDING: return [
      { label: '↩ Back', to: STATUS.NA },
      { label: 'Received', to: STATUS.RECEIVED, primary: true }
    ];
    case STATUS.RECEIVED: return [
      { label: '↩ Reopen', to: STATUS.PENDING }
    ];
    case STATUS.CANCELLED: return [
      { label: 'Restore', to: STATUS.NA }
    ];
    default: return [];
  }
}

// ---- Expiration helpers (store credit) ------------------------------------

/** Whole days until a credit expires (negative = already expired); null if no date. */
export function creditDaysLeft(item, now = new Date()) {
  if (!item.creditExpires) return null;
  const end = new Date(item.creditExpires + 'T23:59:59');
  if (isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}
export function creditExpired(item, now = new Date()) {
  const d = creditDaysLeft(item, now);
  return d != null && d < 0;
}
export function creditExpiringSoon(item, withinDays = 30, now = new Date()) {
  const d = creditDaysLeft(item, now);
  return d != null && d >= 0 && d <= withinDays;
}

// ---- Expected-back / follow-up helpers ------------------------------------
// An optional "expect it back by" date powers in-app nudges and the calendar export.
// These only matter while an item is still outstanding (NA/PENDING).

/** Whole days until the expected-back date (negative = overdue); null if no date. */
export function expectDaysLeft(item, now = new Date()) {
  if (!item.expectBy) return null;
  const end = new Date(item.expectBy + 'T23:59:59');
  if (isNaN(end.getTime())) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}
/** Past its expected-back date and still not received → time to follow up. */
export function isOverdue(item, now = new Date()) {
  if (!isOutstanding(item.status)) return false;
  const d = expectDaysLeft(item, now);
  return d != null && d < 0;
}
/** Expected back within the next few days (and still outstanding). */
export function isDueSoon(item, withinDays = 3, now = new Date()) {
  if (!isOutstanding(item.status)) return false;
  const d = expectDaysLeft(item, now);
  return d != null && d >= 0 && d <= withinDays;
}
/** Count of outstanding items that are past their expected-back date. */
export function countOverdue(items, now = new Date()) {
  let n = 0;
  for (const it of items) if (isOverdue(it, now)) n += 1;
  return n;
}

// ---- Build / edit ----------------------------------------------------------

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
    card: fields.card ? fields.card.trim() : null,   // which card the refund hits (user-named)
    expectBy: fields.expectBy || null,   // optional "expect it back by" date
    purpose: fields.purpose ? fields.purpose.trim() : null,
    reference: fields.reference ? fields.reference.trim() : null,
    receiptRef: fields.receiptRef || null,
    refundMethod: fields.refundMethod || null,
    creditCode: fields.creditCode ? fields.creditCode.trim() : null,
    creditExpires: fields.creditExpires || null,
    creditUsed: !!fields.creditUsed,
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
    card: fields.card !== undefined ? (fields.card ? fields.card.trim() : null) : existing.card,
    expectBy: fields.expectBy !== undefined ? (fields.expectBy || null) : existing.expectBy,
    purpose: fields.purpose ? fields.purpose.trim() : null,
    reference: fields.reference !== undefined ? (fields.reference ? fields.reference.trim() : null) : existing.reference,
    receiptRef: fields.receiptRef !== undefined ? fields.receiptRef : existing.receiptRef,
    refundMethod: fields.refundMethod !== undefined ? fields.refundMethod : existing.refundMethod,
    creditCode: fields.creditCode !== undefined ? (fields.creditCode ? fields.creditCode.trim() : null) : existing.creditCode,
    creditExpires: fields.creditExpires !== undefined ? (fields.creditExpires || null) : existing.creditExpires,
    creditUsed: fields.creditUsed !== undefined ? !!fields.creditUsed : existing.creditUsed,
    status: fields.status || existing.status,
    statusChangedDate: statusChanged ? nowISO() : existing.statusChangedDate
  };
}

/** Return a copy with a new status + fresh statusChangedDate. */
export function withStatus(item, status) {
  if (item.status === status) return item;
  return { ...item, status, statusChangedDate: nowISO() };
}

/** Validate form fields. Returns { ok, errors:{field:msg} } — never throws. */
export function validateFields({ payee, amountText }) {
  const errors = {};
  if (!payee || !payee.trim()) errors.payee = 'Who is this with?';
  if (amountText == null || String(amountText).trim() === '') errors.amount = 'Enter an amount.';
  return { ok: Object.keys(errors).length === 0, errors };
}

/* ----- THE integrity-critical computation -----
   The dashboard totals are ALWAYS this pure function of the full item list, recomputed
   from scratch. Every item lands in exactly one bucket, so nothing can silently disappear. */
export function computeSummary(items) {
  const out = {
    total: items.length,
    outstandingCents: 0, outstandingCount: 0,
    receivedCents: 0, receivedCount: 0,
    storeCreditCents: 0, storeCreditCount: 0,
    cancelledCount: 0
  };
  for (const it of items) {
    const amt = it.amount | 0;
    if (isOutstanding(it.status)) {
      out.outstandingCents += amt; out.outstandingCount += 1;
    } else if (it.status === STATUS.CANCELLED) {
      out.cancelledCount += 1;
    } else if (it.status === STATUS.RECEIVED) {
      if (isStoreCredit(it)) { out.storeCreditCents += amt; out.storeCreditCount += 1; }
      else { out.receivedCents += amt; out.receivedCount += 1; }
    }
  }
  return out;
}

/** Reconciliation check: every item is accounted for in exactly one bucket. */
export function reconciles(items, summary) {
  return summary.total ===
    (summary.outstandingCount + summary.receivedCount + summary.storeCreditCount + summary.cancelledCount);
}
