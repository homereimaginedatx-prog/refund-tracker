/* Dashboard tiles. Pure render from a computed summary — the hero number is always the
   live sum of outstanding items, never a separately stored figure. */

import { el } from '../../core/ui.js';
import { centsToStr } from '../../core/ui.js';

export function renderDashboard(summary) {
  const hero = el('div', { class: 'tile tile-hero' }, [
    el('div', { class: 'tile-label', text: "You're waiting on" }),
    el('div', { class: 'tile-amount', text: centsToStr(summary.outstandingCents) }),
    el('div', {
      class: 'tile-sub',
      text: summary.outstandingCount === 1
        ? '1 item outstanding'
        : `${summary.outstandingCount} items outstanding`
    })
  ]);

  const received = el('div', { class: 'tile tile-mini' }, [
    el('div', { class: 'tile-label', text: 'Received' }),
    el('div', { class: 'tile-amount-mini', text: centsToStr(summary.receivedCents) }),
    el('div', { class: 'tile-sub', text: `${summary.receivedCount} done` })
  ]);

  const credit = el('div', { class: 'tile tile-mini' + (summary.storeCreditCount ? ' tile-credit' : '') }, [
    el('div', { class: 'tile-label', text: 'Store credit to use' }),
    el('div', { class: 'tile-amount-mini', text: centsToStr(summary.storeCreditCents) }),
    el('div', { class: 'tile-sub', text: summary.storeCreditCount ? `${summary.storeCreditCount} to spend` : 'none' })
  ]);

  const tracked = el('div', { class: 'tile tile-mini' }, [
    el('div', { class: 'tile-label', text: 'Tracked' }),
    el('div', { class: 'tile-amount-mini', text: String(summary.total) }),
    el('div', { class: 'tile-sub', text: summary.cancelledCount ? `${summary.cancelledCount} cancelled` : 'items total' })
  ]);

  return el('section', { class: 'dashboard' }, [
    hero,
    el('div', { class: 'tile-row' }, [received, credit, tracked])
  ]);
}
