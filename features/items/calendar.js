/* Calendar export (one-way: app → iPhone Calendar).
   A web app cannot read or write the iOS Calendar directly, so we generate a standard
   .ics file for a single item and hand it to iOS. iOS then shows its own "Add to
   Calendar" sheet where SHE picks which calendar/group and confirms. Changes she makes
   to that calendar event afterward do NOT flow back — the app stays the source of truth,
   and the calendar entry is a convenience copy. (See README for why two-way needs a server.)

   buildICS() is pure and deterministic (all clock values are passed in) so it is unit-tested
   in tests.html. Only addToCalendar() touches the DOM / file system. */

import { centsToStr } from '../../core/ui.js';
import { typeLabel } from './model.js';

/** Escape a value for an ICS text field (RFC 5545): backslash, comma, semicolon, newlines. */
export function icsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** "2026-06-20" → "20260620" (ICS DATE form). Returns null if not a valid YYYY-MM-DD. */
function toICSDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return ymd.replace(/-/g, '');
}

/** "2026-06-06T12:00:00.000Z" → "20260606T120000Z" (ICS UTC date-time, for DTSTAMP). */
function toICSStamp(iso) {
  return String(iso).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Build a one-event VCALENDAR for an item's expected-back date.
 * @param {object} item            the item (needs payee, amount, type, expectBy, id)
 * @param {object} opts
 * @param {string} opts.dtstamp    ISO timestamp for DTSTAMP (pass nowISO())
 * @param {number} [opts.hour=9]   local hour for the reminder (timed, floating, so it shows at 9am)
 * @returns {string|null}          ICS text, or null if the item has no usable expectBy date
 */
export function buildICS(item, { dtstamp, hour = 9 } = {}) {
  const day = toICSDate(item && item.expectBy);
  if (!day) return null;

  const hh = String(hour).padStart(2, '0');
  const start = `${day}T${hh}0000`;            // floating local time → fires at 9am her time
  const endHour = String((hour + 1) % 24).padStart(2, '0');
  const end = `${day}T${endHour}0000`;

  const money = centsToStr(item.amount | 0);
  const who = item.payee || 'a purchase';
  const kind = typeLabel(item.type).toLowerCase(); // "return" | "reimbursement"
  const summary = `Refund follow-up: ${money} from ${who}`;
  const descParts = [
    `Check whether your ${money} ${kind} from ${who} has come back.`,
    item.reference ? `Reference: ${item.reference}` : null,
    'Tracked in Refunds.'
  ].filter(Boolean);

  const uid = `${(item.id || 'item')}@refund-tracker`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Refund Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toICSStamp(dtstamp)}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(descParts.join('\n'))}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(summary)}`,
    'TRIGGER:PT0S',          // alert at the event start (9am that day)
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];
  // ICS uses CRLF line endings.
  return lines.join('\r\n') + '\r\n';
}

/** A safe-ish file name for the download fallback. */
function fileName(item) {
  const who = (item.payee || 'refund').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'refund';
  return `refund-${who}.ics`;
}

/**
 * Generate the .ics for an item and offer it to iOS. On iPhone the Share Sheet opens with
 * iOS shows its native "Add to Calendar" event screen (where she picks the calendar).
 * Returns { ok, reason }.
 *
 * IMPORTANT iOS detail: we OPEN the .ics, we do NOT "share" it. Sharing a calendar file
 * only offers Messages / Mail / Copy / Save to Files — iOS puts no Calendar action in the
 * share sheet. OPENING the file is what makes iOS show the Add-to-Calendar preview. So we
 * navigate to a blob URL (no `download` attribute = open, not save).
 */
export async function addToCalendar(item, { dtstamp } = {}) {
  const ics = buildICS(item, { dtstamp });
  if (!ics) return { ok: false, reason: 'no-date' };

  const blob = new Blob([ics], { type: 'text/calendar' });
  const url = URL.createObjectURL(blob);

  // Open the calendar file. On iPhone this hands off to the system, which shows the
  // "Add to Calendar" screen (calendar picker + Add). target=_blank keeps the app intact.
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    // deliberately NO a.download — that would SAVE the file instead of opening it.
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return { ok: true, reason: 'opened' };
  } catch {
    // Last-ditch fallback: save the file so she can open it from Files → Add to Calendar.
    try {
      const a = document.createElement('a');
      a.href = url; a.download = fileName(item);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      return { ok: true, reason: 'downloaded' };
    } catch {
      URL.revokeObjectURL(url);
      return { ok: false, reason: 'failed' };
    }
  }
}
