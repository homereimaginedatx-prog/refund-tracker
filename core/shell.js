/* The app shell: persistent chrome (header + nav) that hosts whichever feature is active.
   For v1 there's one feature, so the nav is hidden; the registry-driven design means a
   future building block appears as a new tab automatically. */

import { el, clear, daysSince, toast } from './ui.js';
import { getFeatures } from './registry.js';
import { openSettings } from './settings.js';
import { getAllItems, getMeta } from './db.js';
import { exportBackup } from './backup.js';

export async function mountShell(root) {
  clear(root);

  const features = getFeatures();
  let activeId = features.length ? features[0].id : null;

  const title = el('div', { class: 'app-title' }, [
    el('span', { class: 'app-title-main', text: 'Refunds' })
  ]);
  const gear = el('button', { class: 'icon-btn', 'aria-label': 'Settings', text: '⚙︎', onClick: openSettings });
  const header = el('header', { class: 'app-header' }, [title, gear]);

  const banner = el('div', { class: 'banner-host' });
  const content = el('main', { class: 'app-content' });

  const nav = el('nav', { class: 'app-nav' });
  if (features.length > 1) {
    for (const f of features) {
      nav.appendChild(el('button', {
        class: 'nav-btn', dataset: { id: f.id }, text: `${f.icon || ''} ${f.label}`.trim(),
        onClick: () => show(f.id)
      }));
    }
  } else {
    nav.classList.add('hidden');
  }

  root.appendChild(header);
  root.appendChild(banner);
  root.appendChild(content);
  root.appendChild(nav);

  async function show(id) {
    activeId = id;
    const feature = features.find((f) => f.id === id);
    clear(content);
    nav.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('nav-on', b.dataset.id === id));
    if (feature) await feature.mount(content);
  }

  if (activeId) await show(activeId);
  await checkBackupReminder(banner);
}

/* Gentle, dismissible nudge to back up when it's been a while and there's data to lose. */
async function checkBackupReminder(banner) {
  try {
    const [items, last] = await Promise.all([getAllItems(), getMeta('lastBackupAt', null)]);
    const stale = !last || daysSince(last) >= 7;
    if (items.length === 0 || !stale) return;

    const backupBtn = el('button', { class: 'btn btn-small btn-primary', text: 'Back up' });
    const dismiss = el('button', { class: 'btn btn-small btn-ghost', text: 'Later', onClick: () => bar.remove() });
    const bar = el('div', { class: 'banner' }, [
      el('span', { class: 'banner-text', text: last ? 'It’s been a while — back up your data to be safe.' : 'Protect your data: make your first backup.' }),
      el('div', { class: 'banner-actions' }, [backupBtn, dismiss])
    ]);
    backupBtn.addEventListener('click', async () => {
      backupBtn.disabled = true; backupBtn.textContent = '…';
      try {
        const r = await exportBackup();
        toast(r.shared ? 'Backup ready — choose “Save to Files”.' : 'Backup downloaded.', { duration: 6000 });
        bar.remove();
      } catch (e) {
        toast(e.message || 'Backup failed.');
        backupBtn.disabled = false; backupBtn.textContent = 'Back up';
      }
    });
    banner.appendChild(bar);
  } catch { /* never block the app on the reminder */ }
}
