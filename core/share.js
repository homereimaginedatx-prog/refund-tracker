/* "Share Refunds" — let an existing user invite a friend.
   Two seamless paths: Text a friend (native share sheet / SMS) and a QR code to scan
   in person; plus Copy link. The link opens the public Request-Access page, where the
   friend submits their email; Chase approves it (access is never auto-granted).

   The string/URL builders here are PURE (no DOM) so they can be unit-tested. The only
   DOM code is openShareSheet(). */

import { el, clear, toast } from './ui.js';
import { openOverlay } from './overlay.js';
import { encodeText, toSvg } from '../assets/qrcode.js';

// ---- pure helpers (unit-tested) --------------------------------------------

/** The public request-access page URL, resolved relative to the app's own URL so it
    works the same locally and under the GitHub Pages subpath. Optional opaque referral
    code (never an email) is added as ?ref=. */
export function buildRequestUrl(appHref, ref) {
  const u = new URL('request/', appHref);
  if (ref) u.searchParams.set('ref', ref);
  return u.href;
}

/** The friendly pre-filled message a user sends to a friend. */
export function shareMessage(url) {
  return `I've been using this little app to keep track of refunds and money I'm owed back — ` +
    `thought you'd like it! You can request access here: ${url}`;
}

/** An SMS deep link that opens Messages with the invite pre-written. */
export function smsHref(message) {
  // "sms:?&body=" is the broadly-tolerated form across iOS/Android.
  return `sms:?&body=${encodeURIComponent(message)}`;
}

// ---- the share sheet (DOM) --------------------------------------------------

export function openShareSheet({ appHref = location.href, ref = null } = {}) {
  const url = buildRequestUrl(appHref, ref);
  const message = shareMessage(url);

  const body = el('div', { class: 'form share' });
  body.appendChild(el('h2', { class: 'sheet-title', text: 'Share Refunds' }));
  body.appendChild(el('p', {
    class: 'install-lead',
    text: 'Invite a friend or family member. They request access on the next screen, and once it’s approved they can start using it.',
  }));

  // QR code (scan in person)
  const qrWrap = el('div', { class: 'share-qr' });
  try {
    qrWrap.innerHTML = toSvg(encodeText(url, 'M'));
  } catch {
    qrWrap.appendChild(el('p', { class: 'field-hint', text: 'QR unavailable — use the buttons below.' }));
  }
  body.appendChild(qrWrap);
  body.appendChild(el('p', { class: 'share-caption', text: 'Scan this with a phone camera to open the request page.' }));

  // Text a friend (native share / SMS)
  const textBtn = el('button', { class: 'btn btn-primary', text: '✉︎  Text a friend' });
  textBtn.addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ text: message, url }); return; }
      catch { /* user cancelled, or share failed — fall through to SMS */ }
    }
    location.href = smsHref(message);
  });

  // Copy link
  const copyBtn = el('button', { class: 'btn btn-ghost', text: '🔗  Copy link' });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied — paste it anywhere to share.');
    } catch {
      // Fallback: select the preview text so the user can copy manually.
      const range = document.createRange();
      range.selectNodeContents(preview);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      toast('Press and hold to copy the highlighted link.');
    }
  });

  body.appendChild(el('div', { class: 'settings-actions' }, [textBtn, copyBtn]));

  // What the friend receives (transparency)
  body.appendChild(el('p', { class: 'settings-h3', text: 'They’ll receive:' }));
  const preview = el('p', { class: 'share-preview', text: message });
  body.appendChild(preview);

  const closeBtn = el('button', { class: 'btn btn-ghost', text: 'Close', onClick: () => ov.close() });
  body.appendChild(el('div', { class: 'sheet-footer' }, [closeBtn]));

  const ov = openOverlay(body);
}
