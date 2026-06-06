/* Items feature controller. Registers itself with the shell's feature registry.

   Render discipline: after every change we RELOAD items from the database and rebuild the
   view from scratch. The screen is therefore always a direct function of persisted data —
   no optimistic in-memory copy that could drift from what's actually stored. */

import { registerFeature } from '../../core/registry.js';
import { getAllItems, putItem } from '../../core/db.js';
import { el, clear, toast } from '../../core/ui.js';
import { STATUS, computeSummary, withStatus, reconciles } from './model.js';
import { renderDashboard } from './dashboard.js';
import { renderList } from './item-list.js';
import { openItemForm } from './item-form.js';
import { openReceiveFlow } from './receive-flow.js';

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

  c.appendChild(renderDashboard(summary));

  c.appendChild(el('div', { class: 'add-row' }, [
    el('button', { class: 'btn btn-primary btn-add', text: '＋  Add item', onClick: openAdd })
  ]));

  if (state.items.length === 0) {
    c.appendChild(emptyState());
  } else {
    c.appendChild(renderList(state.items, { onOpen: openEdit, onQuick: quickStatus, onMarkUsed: markUsed }));
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
