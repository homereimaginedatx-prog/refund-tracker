/* The durable shared data layer. Every byte of the user's data lives here, in IndexedDB.

   Design rules that protect the data (see plan: "Data integrity & trust guarantees"):
   - Writes resolve on transaction COMPLETE, not just request success, so a save is only
     reported as done once it is durably committed (all-or-nothing / atomic).
   - Errors are PROPAGATED (promise rejects), never swallowed. Callers surface them.
   - Receipt images (Blobs) live in their own store so listing items never loads photos.

   Stores:
     items     keyPath "id"      indexes: byStatus, byCreatedDate
     receipts  keyPath "id"      { id, blob, width, height, createdAt }
     merchants keyPath "payee"   { payee, lastCategory, updatedAt }   (category memory)
     meta      keyPath "key"     { key, value }   (schemaVersion, lastBackupAt, ...) */

const DB_NAME = 'refund-tracker';
const DB_VERSION = 1; // structural version (store shapes). Bump only when stores change.

export const STORES = Object.freeze({
  items: 'items',
  receipts: 'receipts',
  merchants: 'merchants',
  meta: 'meta'
});

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser has no IndexedDB. The app cannot store data here.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.items)) {
        const s = db.createObjectStore(STORES.items, { keyPath: 'id' });
        s.createIndex('byStatus', 'status', { unique: false });
        s.createIndex('byCreatedDate', 'createdDate', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.receipts)) {
        db.createObjectStore(STORES.receipts, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.merchants)) {
        db.createObjectStore(STORES.merchants, { keyPath: 'payee' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // let a newer tab upgrade cleanly
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the database.'));
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab.'));
  });
  return dbPromise;
}

/** Run fn(stores) inside one transaction; resolve with fn's value ONLY after commit. */
async function withTx(storeNames, mode, fn) {
  const db = await openDB();
  const names = [].concat(storeNames);
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(names, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const stores = {};
    for (const n of names) stores[n] = tx.objectStore(n);
    let result;
    let failed = false;
    Promise.resolve()
      .then(() => fn(stores, tx))
      .then((value) => { result = value; })
      .catch((err) => { failed = true; try { tx.abort(); } catch {} reject(err); });
    tx.oncomplete = () => { if (!failed) resolve(result); };
    tx.onabort = () => { if (!failed) reject(tx.error || new Error('Transaction aborted.')); };
    tx.onerror = () => { if (!failed) reject(tx.error || new Error('Transaction error.')); };
  });
}

// Promisify a single IDBRequest.
function reqDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Items -----------------------------------------------------------------

export async function getAllItems() {
  return withTx(STORES.items, 'readonly', (s) => reqDone(s[STORES.items].getAll()));
}
export async function getItem(id) {
  return withTx(STORES.items, 'readonly', (s) => reqDone(s[STORES.items].get(id)));
}
export async function putItem(item) {
  return withTx(STORES.items, 'readwrite', async (s) => {
    await reqDone(s[STORES.items].put(item));
    return item;
  });
}

// ---- Receipts --------------------------------------------------------------

export async function putReceipt(receipt) {
  return withTx(STORES.receipts, 'readwrite', async (s) => {
    await reqDone(s[STORES.receipts].put(receipt));
    return receipt;
  });
}
export async function getReceipt(id) {
  if (!id) return null;
  return withTx(STORES.receipts, 'readonly', (s) => reqDone(s[STORES.receipts].get(id)));
}
export async function getAllReceipts() {
  return withTx(STORES.receipts, 'readonly', (s) => reqDone(s[STORES.receipts].getAll()));
}

// ---- Merchants (category memory) ------------------------------------------

export async function getMerchant(payee) {
  if (!payee) return null;
  return withTx(STORES.merchants, 'readonly', (s) => reqDone(s[STORES.merchants].get(payee)));
}
export async function putMerchant(record) {
  return withTx(STORES.merchants, 'readwrite', async (s) => {
    await reqDone(s[STORES.merchants].put(record));
    return record;
  });
}
export async function getAllMerchants() {
  return withTx(STORES.merchants, 'readonly', (s) => reqDone(s[STORES.merchants].getAll()));
}

// ---- Meta ------------------------------------------------------------------

export async function getMeta(key, fallback = undefined) {
  const row = await withTx(STORES.meta, 'readonly', (s) => reqDone(s[STORES.meta].get(key)));
  return row ? row.value : fallback;
}
export async function setMeta(key, value) {
  return withTx(STORES.meta, 'readwrite', async (s) => {
    await reqDone(s[STORES.meta].put({ key, value }));
    return value;
  });
}
export async function getAllMeta() {
  return withTx(STORES.meta, 'readonly', (s) => reqDone(s[STORES.meta].getAll()));
}

// ---- Restore (atomic full replace) ----------------------------------------

/** Replace ALL stores from a backup, inside ONE transaction. Either the whole restore
    commits or nothing changes — so a failed restore can never leave a half-loaded DB. */
export async function replaceAll({ items = [], receipts = [], merchants = [], meta = [] }) {
  return withTx(
    [STORES.items, STORES.receipts, STORES.merchants, STORES.meta],
    'readwrite',
    async (s) => {
      await reqDone(s[STORES.items].clear());
      await reqDone(s[STORES.receipts].clear());
      await reqDone(s[STORES.merchants].clear());
      await reqDone(s[STORES.meta].clear());
      for (const it of items) await reqDone(s[STORES.items].put(it));
      for (const r of receipts) await reqDone(s[STORES.receipts].put(r));
      for (const m of merchants) await reqDone(s[STORES.merchants].put(m));
      for (const row of meta) await reqDone(s[STORES.meta].put(row));
      return { items: items.length, receipts: receipts.length, merchants: merchants.length };
    }
  );
}

/** Rename a category across ALL items + merchant memory in ONE transaction (QB-style:
    change the name once and it flows through everywhere). Atomic — all or nothing. */
export async function remapCategory(oldName, newName) {
  return withTx([STORES.items, STORES.merchants], 'readwrite', async (s) => {
    const items = await reqDone(s[STORES.items].getAll());
    for (const it of items) {
      if (it.category === oldName) { it.category = newName; await reqDone(s[STORES.items].put(it)); }
    }
    const merchants = await reqDone(s[STORES.merchants].getAll());
    for (const m of merchants) {
      if (m.lastCategory === oldName) { m.lastCategory = newName; await reqDone(s[STORES.merchants].put(m)); }
    }
    return true;
  });
}

/** Rename a card across ALL items in ONE transaction (same flow-through as categories:
    change the name once and every item using it updates). Atomic — all or nothing. */
export async function remapCard(oldName, newName) {
  return withTx(STORES.items, 'readwrite', async (s) => {
    const items = await reqDone(s[STORES.items].getAll());
    for (const it of items) {
      if (it.card === oldName) { it.card = newName; await reqDone(s[STORES.items].put(it)); }
    }
    return true;
  });
}

/** Wipe items, receipts, and merchant memory — but KEEP meta (categories, schemaVersion,
    lastBackupAt). Used by the "Clear all data" action. Atomic. */
export async function clearData() {
  return withTx(
    [STORES.items, STORES.receipts, STORES.merchants],
    'readwrite',
    async (s) => {
      await reqDone(s[STORES.items].clear());
      await reqDone(s[STORES.receipts].clear());
      await reqDone(s[STORES.merchants].clear());
      return true;
    }
  );
}
