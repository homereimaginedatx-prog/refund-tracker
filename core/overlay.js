/* Generic modal overlay. The caller builds the content node; this handles the scrim,
   Escape-to-close, click-outside-to-close, and cleanup. */

import { el } from './ui.js';

export function openOverlay(contentNode, { onClose, dismissible = true } = {}) {
  const root = document.getElementById('overlay-root') || document.body;
  const scrim = el('div', { class: 'scrim' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, [contentNode]);

  const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(); };

  function close() {
    document.removeEventListener('keydown', onKey);
    scrim.classList.add('scrim-out');
    setTimeout(() => scrim.remove(), 180);
    if (onClose) onClose();
  }

  scrim.addEventListener('click', (e) => { if (e.target === scrim && dismissible) close(); });
  document.addEventListener('keydown', onKey);
  scrim.appendChild(panel);
  root.appendChild(scrim);
  // focus the first focusable control for accessibility
  setTimeout(() => {
    const focusable = panel.querySelector('input, textarea, select, button');
    if (focusable) focusable.focus();
  }, 30);

  return { close, panel };
}
