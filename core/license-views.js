/* The gate's two screens (login, locked) plus the runGate orchestrator. Mirrors the
   install gate's card style. The only place the gate touches the DOM. */

import { el, clear, toast } from './ui.js';
import {
  requestCode, verifyCode, check, decideVerdict,
  getToken, getEmail, setToken, setEmail, getCachedStatus, setCachedActive, clearCachedStatus, clearToken
} from './license.js';
import { exportBackup } from './backup.js';

// Decide on launch, then either open the app (onAllowed) or show a gate screen.
export async function runGate(root, onAllowed) {
  if (!getToken()) return renderLogin(root, onAllowed);
  let networkOk = true, serverStatus = null;
  try { const r = await check(); serverStatus = r && r.status; }
  catch { networkOk = false; }
  const verdict = decideVerdict({ hasToken: true, networkOk, serverStatus, cachedStatus: getCachedStatus() });
  if (verdict === 'allow') { if (networkOk) setCachedActive(new Date().toISOString()); return onAllowed(); }
  if (verdict === 'lock') { clearCachedStatus(); return renderLocked(root, onAllowed); }
  return renderLogin(root, onAllowed);
}

// After the app is open, re-check when it returns to the foreground so a revoke is picked
// up without a full relaunch. Online non-active -> reload (boot re-runs the gate -> locked).
// Offline -> do nothing (keep working on the cached verdict).
export function watchRevocation() {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      const r = await check();
      if (r && r.status === 'active') { setCachedActive(new Date().toISOString()); return; }
      if (r && r.status) { clearCachedStatus(); location.reload(); }
    } catch { /* offline — keep working (grace) */ }
  });
}

function gateCard(emoji, title, children) {
  return el('div', { class: 'install-gate' }, [
    el('div', { class: 'install-card' }, [
      el('div', { class: 'install-emoji', text: emoji }),
      el('h1', { text: title }),
      ...children
    ])
  ]);
}

function cooldown(btn, label, secs) {
  btn.disabled = true; let n = secs; btn.textContent = `${label} (${n})`;
  const t = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = label; }
    else btn.textContent = `${label} (${n})`;
  }, 1000);
}

export function renderLogin(root, onAllowed) {
  clear(root);
  const emailInput = el('input', { type: 'email', class: 'input', placeholder: 'you@example.com', autocomplete: 'email', inputmode: 'email' });
  emailInput.value = getEmail();
  const sendBtn = el('button', { class: 'btn btn-primary', text: 'Send code' });
  const codeInput = el('input', { type: 'text', class: 'input', placeholder: '123456', inputmode: 'numeric', maxlength: '6' });
  const verifyBtn = el('button', { class: 'btn btn-primary', text: 'Verify & enter' });
  const backBtn = el('button', { class: 'btn btn-ghost', text: 'Use a different email' });
  const note = el('p', { class: 'install-why', text: '' });

  const step2 = el('div', { class: 'gate-actions hidden' }, [codeInput, verifyBtn, backBtn]);
  const showStep2 = () => { step2.classList.remove('hidden'); codeInput.focus(); };

  async function doSend() {
    const email = (emailInput.value || '').trim();
    if (!email) { note.textContent = 'Please enter your email.'; return; }
    setEmail(email);
    sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
    try {
      await requestCode(email);
      note.textContent = 'If that email is approved, a 6-digit code is on its way. Enter it below.';
      sendBtn.textContent = 'Resend code'; cooldown(sendBtn, 'Resend code', 30);
      showStep2();
    } catch {
      sendBtn.disabled = false; sendBtn.textContent = 'Send code';
      note.textContent = 'You need an internet connection to sign in. Once you're in, the app works offline.';
    }
  }

  async function doVerify() {
    const email = (emailInput.value || '').trim();
    const code = (codeInput.value || '').trim();
    if (!code) { note.textContent = 'Enter the 6-digit code.'; return; }
    verifyBtn.disabled = true; verifyBtn.textContent = 'Checking…';
    try {
      const r = await verifyCode(email, code);
      if (r && r.ok && r.device_token) {
        setToken(r.device_token); setEmail(email); setCachedActive(new Date().toISOString());
        return onAllowed();
      }
      verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & enter';
      note.textContent = 'That code didn't work. Check it and try again, or resend a new one.';
    } catch {
      verifyBtn.disabled = false; verifyBtn.textContent = 'Verify & enter';
      note.textContent = 'Couldn't reach the server. Check your connection and try again.';
    }
  }

  sendBtn.addEventListener('click', doSend);
  verifyBtn.addEventListener('click', doVerify);
  backBtn.addEventListener('click', () => renderLogin(root, onAllowed));

  root.appendChild(gateCard('🔑', 'Sign in', [
    el('p', { class: 'install-lead', text: 'Enter your email and we'll send you a 6-digit code.' }),
    el('div', { class: 'gate-actions' }, [emailInput, sendBtn]),
    step2,
    note
  ]));
}

export function renderLocked(root, onAllowed) {
  clear(root);
  const backupBtn = el('button', { class: 'btn btn-primary', text: 'Back up my data' });
  const retryBtn = el('button', { class: 'btn btn-ghost', text: 'Try again' });
  const switchBtn = el('button', { class: 'btn btn-ghost', text: 'Sign in with a different email' });

  backupBtn.addEventListener('click', async () => {
    backupBtn.disabled = true; backupBtn.textContent = 'Preparing…';
    try {
      // Runs before runMigrations() (the app shell never mounted). Exporting possibly
      // stale-schema data is better than blocking the user's rescue export.
      const r = await exportBackup();
      toast(r.shared ? 'Backup ready — choose "Save to Files" → iCloud Drive.' : 'Backup downloaded.', { duration: 6000 });
    } catch (e) {
      toast((e && e.message) || 'Backup failed.', { duration: 6000 });
    } finally {
      backupBtn.disabled = false; backupBtn.textContent = 'Back up my data';
    }
  });
  // "Try again" re-runs the gate. Offline with no cached-active verdict routes to the
  // login screen (by the decideVerdict matrix) — intentional, not a retry failure.
  retryBtn.addEventListener('click', () => runGate(root, onAllowed));
  switchBtn.addEventListener('click', () => { clearToken(); renderLogin(root, onAllowed); });

  root.appendChild(gateCard('🔒', 'Access paused', [
    el('p', { class: 'install-lead', text: 'Your access to Refunds isn't active right now. Please contact Chase to restore it.' }),
    el('p', { class: 'install-why', text: 'You can still back up your data below — nothing on this device has been deleted.' }),
    el('div', { class: 'gate-actions' }, [backupBtn, retryBtn, switchBtn])
  ]));
}
