/* The license gate's brain: config, on/off switch, device-token storage, the three
   license-server calls, and the pure decision function. No DOM here.

   Privacy: stores ONLY a device token + the email + the last "active" verdict, all in
   localStorage (a device credential — deliberately NOT in IndexedDB, so it never travels
   in a data backup). The user's refund data never passes through here. */

export const BASE = 'https://license-server.homereimaginedatx.workers.dev';
export const PRODUCT_ID = 'refund-tracker';

// Master switch. While false, the gate is dormant and the app behaves exactly as before.
// To enforce: set true, bump version.js, push. (Register users' emails on the server FIRST.)
export const ENFORCE = false;

const K = { token: 'rt_license_token', email: 'rt_license_email', verdict: 'rt_license_verdict' };

// ---- storage (localStorage) ----
export function getToken() { try { return localStorage.getItem(K.token) || null; } catch { return null; } }
export function setToken(t) { try { localStorage.setItem(K.token, t); } catch {} }
export function getEmail() { try { return localStorage.getItem(K.email) || ''; } catch { return ''; } }
export function setEmail(e) { try { localStorage.setItem(K.email, e); } catch {} }
export function getCachedStatus() {
  try { return (JSON.parse(localStorage.getItem(K.verdict)) || {}).status || null; } catch { return null; }
}
export function setCachedActive(nowIso) {
  try { localStorage.setItem(K.verdict, JSON.stringify({ status: 'active', at: nowIso })); } catch {}
}
export function clearCachedStatus() { try { localStorage.removeItem(K.verdict); } catch {} }
// Sign out: drop the token + cached verdict (keep the email to prefill next login).
export function clearToken() { try { localStorage.removeItem(K.token); } catch {} clearCachedStatus(); }

// ---- pure decision (unit-tested) ----
// hasToken(bool), networkOk(bool), serverStatus('active'|'inactive'|'unknown'|null),
// cachedStatus('active'|null) -> 'allow' | 'lock' | 'login'.
export function decideVerdict({ hasToken, networkOk, serverStatus, cachedStatus }) {
  if (!hasToken) return 'login';
  if (networkOk) return serverStatus === 'active' ? 'allow' : 'lock';
  return cachedStatus === 'active' ? 'allow' : 'login'; // offline grace only if last verdict was active
}

// ---- server calls (throw on network failure — that's the offline signal) ----
async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`license-server ${res.status}`);
  return res.json();
}
export function requestCode(email) { return post('/request-code', { email, product_id: PRODUCT_ID }); }
export function verifyCode(email, code) { return post('/verify-code', { email, product_id: PRODUCT_ID, code }); }
export function check() { return post('/check', { device_token: getToken(), product_id: PRODUCT_ID }); }
