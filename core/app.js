/* App bootstrap. Order matters:
   1. surface errors (never fail silently)
   2. register the service worker (offline + update toast)
   3. request persistent storage (best-effort)
   4. if on iOS and NOT installed -> show the install gate (data safety)
   5. run data migrations, then mount the shell

   The items feature is imported for its side effect: it registers itself with the
   registry before the shell reads it. */

import { runMigrations } from './migrations.js';
import { mountShell } from './shell.js';
import { el, clear, toast } from './ui.js';
import '../features/items/items.js';

const root = document.getElementById('app');

boot();

async function boot() {
  surfaceErrors();
  registerServiceWorker();
  await requestPersistentStorage();

  if (isIOS() && !isStandalone()) {
    showInstallGate(startApp);
    return;
  }
  startApp();
}

async function startApp() {
  try {
    await runMigrations();
    await mountShell(root);
  } catch (err) {
    fatal(err);
  }
}

// ---- environment detection -------------------------------------------------

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  const ua = navigator.userAgent || '';
  const iDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPad reports as Mac
  return iDevice || iPadOS;
}

// ---- install gate ----------------------------------------------------------

function showInstallGate(onContinue) {
  clear(root);
  const shareIcon = el('span', { class: 'share-glyph', html: shareSVG() });
  const steps = el('ol', { class: 'install-steps' }, [
    el('li', {}, ['Tap the ', shareIcon, ' Share button in Safari']),
    el('li', { text: 'Choose “Add to Home Screen”' }),
    el('li', { text: 'Open Refunds from its new icon' })
  ]);
  const card = el('div', { class: 'install-card' }, [
    el('div', { class: 'install-emoji', text: '🧾' }),
    el('h1', { text: 'Install Refunds' }),
    el('p', { class: 'install-lead', text: 'Add it to your Home Screen so it works like a real app — and so your data stays safe.' }),
    steps,
    el('p', { class: 'install-why', text: 'Why: Safari can erase data kept in a browser tab, but data in an installed app is protected.' }),
    el('button', {
      class: 'btn btn-ghost install-skip', text: 'Continue in Safari for now',
      onClick: () => {
        toast('Heads up: data in a browser tab can be cleared by Safari. Install to keep it safe.', { duration: 6000 });
        onContinue();
      }
    })
  ]);
  root.appendChild(el('div', { class: 'install-gate' }, [card]));
}

function shareSVG() {
  return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>';
}

// ---- service worker + updates ---------------------------------------------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready.', {
              actionLabel: 'Refresh', sticky: true,
              onAction: () => sw.postMessage({ type: 'SKIP_WAITING' })
            });
          }
        });
      });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
    } catch { /* offline support is optional; app still works */ }
  });
}

// ---- persistent storage ----------------------------------------------------

async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* best-effort only; never gate on this */ }
}

// ---- error handling --------------------------------------------------------

function surfaceErrors() {
  window.addEventListener('error', (e) => console.error('Error:', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled:', e.reason));
}

function fatal(err) {
  console.error(err);
  clear(root);
  root.appendChild(el('div', { class: 'fatal' }, [
    el('h2', { text: 'Something went wrong' }),
    el('p', { text: (err && err.message) || 'The app could not start.' }),
    el('button', { class: 'btn btn-primary', text: 'Reload', onClick: () => location.reload() })
  ]));
}
