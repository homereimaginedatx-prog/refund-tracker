/* User-defined category list. The user builds their own taxonomy — categories they add
   while entering items persist and become reusable choices. Stored in the meta store. */

import { getMeta, setMeta, remapCategory } from '../../core/db.js';

const KEY = 'categories';

export async function getCategories() {
  const c = await getMeta(KEY, null);
  return Array.isArray(c) ? c : [];
}

export async function addCategory(name) {
  const n = (name || '').trim();
  if (!n) return getCategories();
  const list = await getCategories();
  if (!list.some((x) => x.toLowerCase() === n.toLowerCase())) {
    list.push(n);
    list.sort((a, b) => a.localeCompare(b));
    await setMeta(KEY, list);
  }
  return getCategories();
}

export async function removeCategory(name) {
  const list = (await getCategories()).filter((x) => x !== name);
  await setMeta(KEY, list);
  return list;
}

/** Rename a category in the list AND flow the change through to every item that used it. */
export async function renameCategory(oldName, newName) {
  const n = (newName || '').trim();
  if (!n || n === oldName) return getCategories();
  // Update the list (merge if the new name already exists).
  let list = (await getCategories()).map((c) => (c === oldName ? n : c));
  list = [...new Set(list)].sort((a, b) => a.localeCompare(b));
  await setMeta(KEY, list);
  // Flow through to all items + merchant memory.
  await remapCategory(oldName, n);
  return getCategories();
}
