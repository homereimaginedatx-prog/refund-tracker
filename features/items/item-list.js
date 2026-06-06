/* The register: items grouped by status. Outstanding items sort oldest-waiting first
   (most actionable). Nothing is ever hidden — cancelled items show in their own group. */

import { el, centsToStr, formatDate, agingLabel } from '../../core/ui.js';
import {
  STATUS, STATUS_ORDER, isOutstanding, statusLabel, statusGroupLabel, typeLabel, quickActions
} from './model.js';

export function renderList(items, handlers = {}) {
  const wrap = el('div', { class: 'list' });

  for (const status of STATUS_ORDER) {
    const group = items.filter((it) => it.status === status);
    if (group.length === 0) continue;

    group.sort((a, b) => {
      if (isOutstanding(status)) {
        return new Date(a.statusChangedDate) - new Date(b.statusChangedDate); // oldest first
      }
      return new Date(b.statusChangedDate) - new Date(a.statusChangedDate); // newest first
    });

    const subtotal = group.reduce((sum, it) => sum + (it.amount | 0), 0);
    const header = el('div', { class: 'group-head' }, [
      el('span', { class: 'group-title', text: statusGroupLabel(status) }),
      el('span', { class: 'group-meta', text: `${group.length} · ${centsToStr(subtotal)}` })
    ]);
    wrap.appendChild(header);

    for (const item of group) wrap.appendChild(renderCard(item, handlers));
  }

  return wrap;
}

function renderCard(item, handlers) {
  const metaParts = [formatDate(item.date), typeLabel(item.type)];
  if (item.category) metaParts.push(item.category);

  const left = el('div', { class: 'card-left' }, [
    el('div', { class: 'card-payee', text: item.payee || '(no name)' }),
    el('div', { class: 'card-meta', text: metaParts.join(' · ') })
  ]);
  if (item.receiptRef) {
    left.querySelector('.card-meta').appendChild(el('span', { class: 'receipt-chip', text: ' 📎 receipt' }));
  }

  const right = el('div', { class: 'card-right' }, [
    el('div', { class: 'card-amount', text: centsToStr(item.amount) }),
    el('div', { class: `pill pill-${item.status}`, text: statusLabel(item.status, item.type) })
  ]);
  if (isOutstanding(item.status)) {
    right.appendChild(el('div', { class: 'card-aging', text: `waiting ${agingLabel(item.statusChangedDate)}` }));
  }

  const actions = el('div', { class: 'card-actions' });
  for (const a of quickActions(item.status)) {
    actions.appendChild(el('button', {
      class: 'btn btn-small' + (a.primary ? ' btn-primary' : ' btn-ghost'),
      text: a.label,
      onClick: (e) => { e.stopPropagation(); handlers.onQuick && handlers.onQuick(item, a.to); }
    }));
  }
  actions.appendChild(el('button', {
    class: 'btn btn-small btn-ghost',
    text: 'Edit',
    onClick: (e) => { e.stopPropagation(); handlers.onOpen && handlers.onOpen(item); }
  }));

  const card = el('div', { class: 'card', tabindex: '0', role: 'button' }, [
    el('div', { class: 'card-body' }, [left, right]),
    actions
  ]);
  card.addEventListener('click', () => handlers.onOpen && handlers.onOpen(item));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onOpen && handlers.onOpen(item); }
  });
  return card;
}
