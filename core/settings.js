/* Settings sheet: backup, restore, version, and storage info.
   Backup/restore are the user-facing half of the durability safety net. */

import { el, toast, formatDate, daysSince } from './ui.js';
import { openOverlay } from './overlay.js';
import { exportBackup, importBackupFromFile } from './backup.js';
import { getMeta } from './db.js';

export async function openSettings() {
  const body = el('div', { class: 'form settings' });
  body.appendChild(el('h2', { class: 'sheet-title', text: 'Settings' }));

  body.appendChild(infoRow('App version', String(globalThis.APP_VERSION || 'dev')));

  const last = await getMeta('lastBackupAt', null);
  const lastRow = infoRow('Last backup', last ? `${formatDate(last)} · ${daysSince(last)}d ago` : 'never');
  body.appendChild(lastRow);

  const storageRow = infoRow('Storage used', '…');
  body.appendChild(storageRow);
  estimateStorage().then((t) => setVal(storageRow, t));

  const persistRow = infoRow('Storage protected', '…');
  body.appendChild(persistRow);
  checkPersisted().then((t) => setVal(persistRow, t));

  // Backup
  const backupBtn = el('button', { class: 'btn btn-primary', text: '⬆︎  Back up now' });
  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true; backupBtn.textContent = 'Preparing…';
    try {
      const r = await exportBackup();
      toast(r.shared ? 'Backup ready — choose “Save to Files” → iCloud Drive.' : 'Backup downloaded.', { duration: 6000 });
      setVal(lastRow, 'just now');
    } catch (e) {
      toast(e.message || 'Backup failed.', { duration: 6000 });
    } finally {
      backupBtn.disabled = false; backupBtn.textContent = '⬆︎  Back up now';
    }
  });

  // Restore
  const restoreInput = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden-file' });
  const restoreBtn = el('button', { class: 'btn btn-ghost', text: '⬇︎  Restore from backup', onClick: () => restoreInput.click() });
  restoreInput.addEventListener('change', async () => {
    const file = restoreInput.files && restoreInput.files[0];
    if (!file) return;
    const ok = confirm('Restore will REPLACE everything in the app with the contents of this backup file. Continue?');
    if (!ok) { restoreInput.value = ''; return; }
    restoreBtn.disabled = true; restoreBtn.textContent = 'Restoring…';
    try {
      const c = await importBackupFromFile(file);
      toast(`Restored ${c.items} item(s). Reloading…`);
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      toast(e.message || 'Restore failed — your current data was not changed.', { duration: 7000 });
      restoreBtn.disabled = false; restoreBtn.textContent = '⬇︎  Restore from backup';
      restoreInput.value = '';
    }
  });

  body.appendChild(el('div', { class: 'settings-actions' }, [backupBtn, restoreBtn, restoreInput]));
  body.appendChild(el('p', {
    class: 'settings-note',
    text: 'Your data is stored only on this iPad. Back up to iCloud Drive regularly — the backup file is your safety copy if anything ever happens to the device.'
  }));

  const closeBtn = el('button', { class: 'btn btn-ghost', text: 'Close', onClick: () => ov.close() });
  body.appendChild(el('div', { class: 'sheet-footer' }, [closeBtn]));

  const ov = openOverlay(body);
}

function infoRow(label, value) {
  return el('div', { class: 'info-row' }, [
    el('span', { class: 'info-label', text: label }),
    el('span', { class: 'info-val', text: value })
  ]);
}
function setVal(row, text) { const v = row.querySelector('.info-val'); if (v) v.textContent = text; }

async function estimateStorage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0 } = await navigator.storage.estimate();
      const mb = usage / (1024 * 1024);
      return mb < 1 ? `${Math.round(usage / 1024)} KB` : `${mb.toFixed(1)} MB`;
    }
  } catch { /* ignore */ }
  return 'unavailable';
}

async function checkPersisted() {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return (await navigator.storage.persisted()) ? 'Yes' : 'Best-effort (install to home screen)';
    }
  } catch { /* ignore */ }
  return 'unknown';
}
