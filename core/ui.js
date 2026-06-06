/* Small, dependency-free UI + formatting helpers.
   The money/date functions are PURE (no DOM, no globals) so they can be unit-tested
   in tests.html. Money is always handled as integer CENTS to avoid float rounding bugs. */

// ---- Money -----------------------------------------------------------------

/** Format integer cents as "$1,234.56". Negative-safe. */
export function centsToStr(cents) {
  const n = Number(cents) || 0;
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  const grouped = dollars.toLocaleString('en-US');
  return `${sign}$${grouped}.${rem}`;
}

/** Parse a user-typed amount ("$1,234.5", "12", "12.00") to integer cents.
    Returns null if it isn't a valid, positive money value. */
export function parseAmountToCents(input) {
  if (input == null) return null;
  const cleaned = String(input).replace(/[$,\s]/g, '');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

// ---- Dates -----------------------------------------------------------------

/** Local calendar date as YYYY-MM-DD. */
export function todayISODate(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Full timestamp for audit fields. */
export function nowISO(now = new Date()) {
  return now.toISOString();
}

/** Whole days between an ISO date/datetime and now (>= 0). */
export function daysSince(iso, now = new Date()) {
  if (!iso) return 0;
  const then = new Date(iso);
  if (isNaN(then.getTime())) return 0;
  const ms = now.getTime() - then.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

/** "Jun 6, 2026" from a YYYY-MM-DD or ISO string. */
export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "today", "yesterday", "5 days" — friendly aging label. */
export function agingLabel(iso, now = new Date()) {
  const d = daysSince(iso, now);
  if (d <= 0) return 'today';
  if (d === 1) return '1 day';
  return `${d} days`;
}

// ---- DOM helpers -----------------------------------------------------------

/** Create an element. props.class, props.text, props.html, props.on{Event}, attrs. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k in node && k !== 'list') {
      try { node[k] = v; } catch { node.setAttribute(k, v); }
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
}

let uidCounter = 0;
/** Stable unique id (uses crypto.randomUUID when available). */
export function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  uidCounter += 1;
  return `id-${Date.now().toString(36)}-${uidCounter}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

// ---- Toast -----------------------------------------------------------------

/** Show a transient message. Optional action button. Returns a dismiss() fn. */
export function toast(message, { actionLabel, onAction, duration = 4000, sticky = false } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  const card = el('div', { class: 'toast', role: 'status' }, [
    el('span', { class: 'toast-msg', text: message })
  ]);
  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    card.classList.add('toast-out');
    setTimeout(() => card.remove(), 200);
  };
  if (actionLabel && onAction) {
    card.appendChild(el('button', {
      class: 'toast-action',
      text: actionLabel,
      onClick: () => { try { onAction(); } finally { dismiss(); } }
    }));
  }
  card.appendChild(el('button', { class: 'toast-close', text: '✕', 'aria-label': 'Dismiss', onClick: dismiss }));
  root.appendChild(card);
  if (!sticky) timer = setTimeout(dismiss, duration);
  return dismiss;
}
