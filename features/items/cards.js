/* User-defined card list. She names her own cards ("Chase Sapphire", "Amex Blue", "Apple
   Card") so an item can record which card the money should come back to — i.e. which card
   to go check. Same build-your-own + rename-flows-through pattern as categories. Stored in
   the meta store under 'cards'. */

import { getMeta, setMeta, remapCard } from '../../core/db.js';

const KEY = 'cards';

export async function getCards() {
  const c = await getMeta(KEY, null);
  return Array.isArray(c) ? c : [];
}

export async function addCard(name) {
  const n = (name || '').trim();
  if (!n) return getCards();
  const list = await getCards();
  if (!list.some((x) => x.toLowerCase() === n.toLowerCase())) {
    list.push(n);
    list.sort((a, b) => a.localeCompare(b));
    await setMeta(KEY, list);
  }
  return getCards();
}

export async function removeCard(name) {
  const list = (await getCards()).filter((x) => x !== name);
  await setMeta(KEY, list);
  return list;
}

/** Rename a card in the list AND flow the change through to every item that used it. */
export async function renameCard(oldName, newName) {
  const n = (newName || '').trim();
  if (!n || n === oldName) return getCards();
  let list = (await getCards()).map((c) => (c === oldName ? n : c));
  list = [...new Set(list)].sort((a, b) => a.localeCompare(b));
  await setMeta(KEY, list);
  await remapCard(oldName, n);
  return getCards();
}
