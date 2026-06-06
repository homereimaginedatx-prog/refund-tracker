/* Backup & restore — the data-durability safety net.

   Local storage on iOS can be evicted (especially if the app runs in a Safari tab instead
   of installed). The exported backup file is the ONLY copy fully under the user's control,
   so it is treated as the authoritative record. Export writes a single self-contained JSON
   file (receipt photos embedded as data URLs) and offers it to the iOS Share Sheet so the
   user can "Save to Files" -> iCloud Drive. Restore replaces everything atomically. */

import {
  getAllItems, getAllReceipts, getAllMerchants, getAllMeta, replaceAll, setMeta
} from './db.js';
import { CURRENT_SCHEMA, runMigrations } from './migrations.js';
import { nowISO, todayISODate, el } from './ui.js';

const ENVELOPE_KIND = 'refund-tracker-backup';

// ---- pure helpers (testable) ----------------------------------------------

export function buildEnvelope({ items, merchants, meta, receipts, appVersion, exportedAt }) {
  return {
    app: 'refund-tracker',
    kind: ENVELOPE_KIND,
    schemaVersion: CURRENT_SCHEMA,
    appVersion: appVersion || null,
    exportedAt: exportedAt || null,
    counts: {
      items: items.length,
      receipts: receipts.length,
      merchants: merchants.length
    },
    items,
    merchants,
    meta,
    receipts
  };
}

export function validateEnvelope(obj) {
  if (!obj || typeof obj !== 'object') throw new Error("That file isn't a backup.");
  if (obj.kind !== ENVELOPE_KIND) throw new Error("That file isn't a Refund Tracker backup.");
  if (!Array.isArray(obj.items)) throw new Error('Backup is missing its items list.');
  return true;
}

// ---- blob <-> data URL -----------------------------------------------------

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('Could not read a receipt image.'));
    fr.readAsDataURL(blob);
  });
}

export async function dataURLToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

// ---- export ----------------------------------------------------------------

export async function buildBackupBlob() {
  const [items, merchants, meta, receiptRows] = await Promise.all([
    getAllItems(), getAllMerchants(), getAllMeta(), getAllReceipts()
  ]);
  const receipts = [];
  for (const r of receiptRows) {
    receipts.push({
      id: r.id, width: r.width, height: r.height, createdAt: r.createdAt,
      dataUrl: await blobToDataURL(r.blob)
    });
  }
  const env = buildEnvelope({
    items, merchants, meta, receipts,
    appVersion: globalThis.APP_VERSION, exportedAt: nowISO()
  });
  return new Blob([JSON.stringify(env)], { type: 'application/json' });
}

export async function exportBackup() {
  const blob = await buildBackupBlob();
  const filename = `refund-tracker-backup-${todayISODate()}.json`;
  const file = new File([blob], filename, { type: 'application/json' });

  let shared = false;
  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Refund Tracker backup' });
      shared = true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') shared = true; // user closed the share sheet
  }
  if (!shared) downloadFile(blob, filename);

  await setMeta('lastBackupAt', nowISO());
  return { filename, shared };
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---- import / restore ------------------------------------------------------

export async function importBackupFromFile(file) {
  const text = await file.text();
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("Couldn't read that file — it may be corrupted or not a backup.");
  }
  validateEnvelope(obj);

  const receipts = [];
  for (const r of obj.receipts || []) {
    receipts.push({
      id: r.id, width: r.width, height: r.height, createdAt: r.createdAt,
      blob: await dataURLToBlob(r.dataUrl)
    });
  }

  const meta = (obj.meta || []).slice();
  if (!meta.some((m) => m.key === 'schemaVersion')) {
    meta.push({ key: 'schemaVersion', value: obj.schemaVersion || CURRENT_SCHEMA });
  }

  const counts = await replaceAll({
    items: obj.items || [], merchants: obj.merchants || [], meta, receipts
  });
  await runMigrations(); // upgrade restored data if it came from an older schema
  return counts;
}
