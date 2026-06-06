/* Items feature controller. Registers itself with the shell's feature registry.

   Render discipline: after every change we RELOAD items from the database and rebuild the
   view from scratch. The screen is therefore always a direct function of persisted data —
   no optimistic in-memory copy that could drift from what's actually stored. */

import { registerFeature } from '../../core/registry.js';
import { getAllItems, putItem } from '../../core/db.js';
import { el, clear, toast, nowISO } from '../../core/ui.js';
import { STATUS, computeSummary, withStatus, reconciles, countOverdue } from './model.js';
import { renderDashboard } from './dashboard.js';
import { renderList } from './item-list.js';
import { openItemForm } from './item-form.js';
import { openReceiveFlow } from './receive-flow.js';
import { openReturnFlow } from './return-flow.js';
import { addToCalendar } from './calendar.js';

const state = { container: null, items: [] };

async function reload() {
  state.items = await getAllItems();
}

function render() {
  const c = state.container;
  if (!c) return;
  clear(c);

  const summary = computeSummary(state.items);
  // Safety assertion: every item must be accounted for exactly once.
  if (!reconciles(state.items, summary)) {
    console.warn('Summary did not reconcile', summary);
  }

  c.appendChild(renderDashboard(summary, { overdueCount: countOverdue(state.items) }));

  c.appendChild(el('div', { class: 'add-row' }, [
    el('button', { class: 'btn btn-primary btn-add', text: '＋  Add item', onClick: openAdd })
  ]));

  if (state.items.length === 0) {
    c.appendChild(emptyState());
  } else {
    c.appendChild(renderList(state.items, {
      onOpen: openEdit, onQuick: quickStatus, onMarkUsed: markUsed, onAddToCalendar: addItemToCalendar
    }));
  }
}

function emptyState() {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-emoji', text: '🧾' }),
    el('h3', { text: 'Nothing tracked yet' }),
    el('p', { text: 'Add the first thing you’re waiting to get money back on.' })
  ]);
}

async function refresh() {
  await reload();
  render();
}

function openAdd() { openItemForm({ onSaved: refresh }); }
function openEdit(item) { openItemForm({ item, onSaved: refresh }); }

async function quickStatus(item, toStatus) {
  // Starting a return (To do → Waiting) opens the quick in-field capture flow.
  if (item.status === STATUS.NA && toStatus === STATUS.PENDING) {
    openReturnFlow(item, refresh);
    return;
  }
  // Marking Received opens the "how did you get it back?" flow (money vs store credit).
  if (toStatus === STATUS.RECEIVED) {
    openReceiveFlow(item, refresh);
    return;
  }
  try {
    await putItem(withStatus(item, toStatus));
    await refresh();
  } catch (err) {
    toast(err.message || 'Could not update — please try again.');
  }
}

/* One-way calendar export. iOS shows its own "Add to Calendar" sheet (she picks the
   calendar); we never read the event back, so the app stays the source of truth. */
async function addItemToCalendar(item) {
  try {
    const r = await addToCalendar(item, { dtstamp: nowISO() });
    if (r.ok && (r.reason === 'shared' || r.reason === 'opened')) toast('In the sheet, tap “Add to Calendar” (or Save to Files, then open it).', { duration: 7000 });
    else if (r.ok && r.reason === 'downloaded') toast('Saved the calendar file — tap it to add the reminder.', { duration: 6000 });
    else if (r.reason === 'cancelled') { /* she backed out — no message */ }
    else if (r.reason === 'no-date') toast('Add an “expect it back by” date first — tap Edit.');
    else if (r.reason === 'unsupported') toast('Calendar isn’t available from the app here — your in-app reminders still have you covered.', { duration: 7000 });
    else toast('Could not create the calendar reminder.');
  } catch (err) {
    toast(err.message || 'Could not create the calendar reminder.');
  }
}

async function markUsed(item) {
  try {
    await putItem({ ...item, creditUsed: true });
    await refresh();
    toast('Store credit marked used.');
  } catch (err) {
    toast(err.message || 'Could not update — please try again.');
  }
}

async function mount(container) {
  state.container = container;
  await reload();
  render();
}

registerFeature({ id: 'items', label: 'Refunds', icon: '🧾', mount });
