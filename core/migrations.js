/* Data-model migrations.

   This is SEPARATE from db.js's structural DB_VERSION. CURRENT_SCHEMA versions the SHAPE
   of the data (fields on an item, etc.). When a future building block adds or renames a
   field, add a step here and bump CURRENT_SCHEMA. On boot, runMigrations() walks any
   stored data up to the current schema so old backups/installs upgrade safely. */

import { getMeta, setMeta, getAllItems, putItem } from './db.js';

export const CURRENT_SCHEMA = 1;

/* Each step transforms data from version (n-1) to (n).
   Example for the future:
     2: async () => { for (const it of await getAllItems()) { it.newField ??= null; await putItem(it); } }
*/
const STEPS = {
  // 1: fresh schema — nothing to transform.
};

export async function runMigrations() {
  let current = await getMeta('schemaVersion', 0);

  // Fresh install (no data yet): just stamp the current schema, no transform needed.
  if (current === 0) {
    await setMeta('schemaVersion', CURRENT_SCHEMA);
    return { from: 0, to: CURRENT_SCHEMA, migrated: false };
  }

  const from = current;
  while (current < CURRENT_SCHEMA) {
    const step = STEPS[current + 1];
    if (step) await step();
    current += 1;
    await setMeta('schemaVersion', current);
  }
  return { from, to: current, migrated: from !== current };
}
