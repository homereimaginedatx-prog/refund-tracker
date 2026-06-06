/* The register, grouped by view group (To do → Waiting → Store credit to use → Received →
   Cancelled). Active items show a tappable progress stepper; unspent store credits get a
   dedicated section with code + expiration warning + "Mark used". */

import { el, centsToStr, formatDate, agingLabel, toast } from '../../core/ui.js';
import {
  STATUS, VIEW_ORDER, getViewGroup, viewGroupLabel, isOutstanding, typeLabel,
  creditDaysLeft, creditExpired, creditExpiringSoon,
  expectDaysLeft, isOverdue, isDueSoon
} from './model.js';

const STEPS = [
  { status: STATUS.NA, label: 'To do' },
  { status: STATUS.PENDING, label: 'Waiting' },
  { status: STATUS.RECEIVED, label: 'Received' }
];

export function renderList(items, handlers = {}) {
  const wrap = el('div', { class: 'list' });

  if (items.some((it) => isOutstanding(it.status))) {
    wrap.appendChild(el('p', { class: 'list-tip', text: 'Tap a step to update an item.  ● = where it is now.' }));
  }

  const groups = {};
  for (const it of items) (groups[getViewGroup(it)] ||= []).push(it);

  for (const g of VIEW_ORDER) {
    const group = groups[g];
    if (!group || group.length === 0) continue;

    group.sort((a, b) => (g === 'todo' || g === 'waiting')
      ? new Date(a.statusChangedDate) - new Date(b.statusChangedDate)
      : new Date(b.statusChangedDate) - new Date(a.statusChangedDate));

    const subtotal = group.reduce((sum, it) => sum + (it.amount | 0), 0);
    wrap.appendChild(el('div', { class: 'group-head' }, [
      el('span', { class: 'group-title' + (g === 'credit' ? ' group-title-credit' : ''), text: viewGroupLabel(g) }),
      el('span', { class: 'group-meta', text: `${group.length} · ${centsToStr(subtotal)}` })
    ]));

    for (const item of group) {
      wrap.appendChild(g === 'credit' ? renderCreditCard(item, handlers)
        : g === 'cancelled' ? renderCancelledCard(item, handlers)
          : renderCard(item, handlers));
    }
  }

  return wrap;
}

function metaLine(item) {
  const parts = [formatDate(item.date), typeLabel(item.type)];
  if (item.category) parts.push(item.category);
  if (item.reference) parts.push('#' + item.reference);
  const meta = el('div', { class: 'card-meta', text: parts.join(' · ') });
  if (item.receiptRef) meta.appendChild(el('span', { class: 'receipt-chip', text: ' 📎 receipt' }));
  return meta;
}

function renderCard(item, handlers) {
  const left = el('div', { class: 'card-left' }, [
    el('div', { class: 'card-payee', text: item.payee || '(no name)' }),
    metaLine(item)
  ]);
  if (isOutstanding(item.status)) {
    left.appendChild(el('div', { class: 'card-aging', text: `waiting ${agingLabel(item.statusChangedDate)}` }));
    if (item.expectBy) left.appendChild(renderDueBadge(item));
  }
  const right = el('div', { class: 'card-right' }, [el('div', { class: 'card-amount', text: centsToStr(item.amount) })]);

  const foot = el('div', { class: 'card-foot' }, [
    isOutstanding(item.status) && item.expectBy
      ? el('button', { class: 'link-btn', text: '📅 Add to Calendar', onClick: () => handlers.onAddToCalendar && handlers.onAddToCalendar(item) })
      : null,
    el('button', { class: 'link-btn', text: 'Edit', onClick: () => handlers.onOpen && handlers.onOpen(item) }),
    el('button', { class: 'link-btn danger', text: 'Cancel', onClick: () => handlers.onQuick && handlers.onQuick(item, STATUS.CANCELLED) })
  ]);

  return el('div', { class: 'card' }, [
    el('div', { class: 'card-body' }, [left, right]),
    renderStepper(item, handlers),
    foot
  ]);
}

/* Expected-back badge: neutral by default, amber when it's coming up, red once overdue. */
function renderDueBadge(item) {
  const days = expectDaysLeft(item);
  let cls = 'due-ok', text = `Expected back ${formatDate(item.expectBy)}`;
  if (isOverdue(item)) {
    const over = Math.abs(days);
    cls = 'due-over';
    text = `⚠ Overdue ${over} day${over === 1 ? '' : 's'} — time to follow up`;
  } else if (isDueSoon(item)) {
    cls = 'due-soon';
    text = days === 0 ? '⏰ Expected back today' : `⏰ Expected back in ${days} day${days === 1 ? '' : 's'}`;
  }
  return el('div', { class: `due-badge ${cls}`, text });
}

/* Tappable progress stepper. Current step is filled (●); earlier steps show ✓; the next
   step is accented as the obvious tap target. Tapping any step sets that status. */
function renderStepper(item, handlers) {
  const curIdx = STEPS.findIndex((s) => s.status === item.status);
  const track = el('div', { class: 'stepper', role: 'group', 'aria-label': 'Status' });
  STEPS.forEach((step, i) => {
    if (i > 0) track.appendChild(el('span', { class: 'step-arrow', text: '→', 'aria-hidden': 'true' }));
    const state = i < curIdx ? 'done' : i === curIdx ? 'current' : 'todo';
    const dot = i < curIdx ? '✓' : i === curIdx ? '●' : '';
    track.appendChild(el('button', {
      class: `step step-${state}` + (i === curIdx + 1 ? ' step-next' : ''),
      'aria-current': i === curIdx ? 'true' : null,
      onClick: () => { if (step.status !== item.status) handlers.onQuick && handlers.onQuick(item, step.status); }
    }, [el('span', { class: 'step-dot', text: dot }), el('span', { class: 'step-label', text: step.label })]));
  });
  return track;
}

function renderCreditCard(item, handlers) {
  const left = el('div', { class: 'card-left' }, [
    el('div', { class: 'card-payee', text: item.payee || '(no name)' }),
    metaLine(item)
  ]);

  // Code (tap to copy)
  if (item.creditCode) {
    const codeBtn = el('button', {
      class: 'credit-code', title: 'Tap to copy', text: `🎟 ${item.creditCode}`,
      onClick: async () => {
        try { await navigator.clipboard.writeText(item.creditCode); toast('Code copied.'); }
        catch { toast('Code: ' + item.creditCode, { duration: 6000 }); }
      }
    });
    left.appendChild(codeBtn);
  }

  // Expiration badge
  if (item.creditExpires) {
    const days = creditDaysLeft(item);
    let cls = 'exp-ok', text = `Expires ${formatDate(item.creditExpires)}`;
    if (creditExpired(item)) { cls = 'exp-bad'; text = `⚠ Expired ${formatDate(item.creditExpires)}`; }
    else if (creditExpiringSoon(item)) { cls = 'exp-soon'; text = `⚠ Expires in ${days} day${days === 1 ? '' : 's'}`; }
    left.appendChild(el('div', { class: `exp-badge ${cls}`, text }));
  }

  const right = el('div', { class: 'card-right' }, [
    el('div', { class: 'card-amount', text: centsToStr(item.amount) }),
    el('div', { class: 'pill pill-credit', text: '🎁 Store credit' })
  ]);

  const foot = el('div', { class: 'card-foot' }, [
    el('button', { class: 'btn btn-small btn-primary', text: '✓ Mark used', onClick: () => handlers.onMarkUsed && handlers.onMarkUsed(item) }),
    el('button', { class: 'link-btn', text: 'Edit', onClick: () => handlers.onOpen && handlers.onOpen(item) })
  ]);

  return el('div', { class: 'card card-credit' }, [el('div', { class: 'card-body' }, [left, right]), foot]);
}

function renderCancelledCard(item, handlers) {
  const left = el('div', { class: 'card-left' }, [
    el('div', { class: 'card-payee', text: item.payee || '(no name)' }),
    metaLine(item)
  ]);
  const right = el('div', { class: 'card-right' }, [el('div', { class: 'card-amount', text: centsToStr(item.amount) })]);
  const foot = el('div', { class: 'card-foot' }, [
    el('span', { class: 'pill pill-cancelled', text: 'Cancelled' }),
    el('button', { class: 'link-btn', text: 'Restore', onClick: () => handlers.onQuick && handlers.onQuick(item, STATUS.NA) })
  ]);
  return el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [left, right]), foot]);
}
