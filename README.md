# Refund Tracker

A tiny, installable iPad app for tracking refunds and reimbursements you're still waiting
on — returns to stores, money owed back from work, anything where you spent first and
expect the money to come back. Snap a receipt photo, see what you're still owed at a
glance, and mark it received when the money lands.

Built as a **Progressive Web App (PWA)**: no App Store, no fees, no server. It's plain
HTML/CSS/JavaScript with **zero dependencies and no build step** — the files in this repo
are exactly what runs in the browser, so it stays maintainable for years.

---

## How your friend installs it (send a LINK, not a file)

1. Send her the published URL (see *Deploy* below).
2. She opens it in **Safari** on the iPad.
3. Taps the **Share** button → **Add to Home Screen**.
4. Opens **Refunds** from the new home-screen icon.

That's it — it now behaves like a real app, works offline, and updates itself whenever you
push a change. Installing to the home screen is also what keeps her data safe (see below).

> She never needs a GitHub account. The repo only holds the app's code; **none of her data
> is ever in the repo** — it lives only on her iPad and in her backup files.

---

## Where the data lives & why backups matter

All data (items + receipt photos) is stored **on the iPad** in the browser's IndexedDB.

iOS can erase locally-stored data in two cases:
- Data kept in a normal **Safari tab** is wiped after ~7 idle days. **Installing to the
  home screen avoids this** — installed apps are exempt. (The app shows an install screen
  on iOS until it's installed.)
- The device is wiped, the app is deleted, or storage runs critically low.

So the **backup file is the real safety net.** In **Settings (⚙︎ → Back up now)** the app
writes a single `.json` file containing everything (receipts included) and offers it to the
iOS Share Sheet → **Save to Files → iCloud Drive**. To restore on a new device: install the
app, then **Settings → Restore from backup**. The app nudges her to back up when it's been
a while.

---

## Run it locally (to develop)

PWAs need to be served over http(s) — opening `index.html` from the file system won't run
the service worker. Use any static server, e.g.:

```bash
# Python (built in on macOS)
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the self-tests by opening `http://localhost:8000/tests.html` — it checks the
integrity-critical logic (money math, status totals/reconciliation, backup round-trip).

---

## Deploy (GitHub Pages, free)

1. Create a **public** GitHub repo and push this folder to it.
2. Repo **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main` / `/root`.
3. Your app is live at `https://<you>.github.io/<repo>/`. Send that link.

All paths in the app are **relative (`./`)**, so it works correctly under the
`/<repo>/` subpath. Don't change them to start with `/`.

### Pushing an update
1. Edit the code, commit, push.
2. **Bump the version** in [`version.js`](./version.js) (e.g. `2026.06.20`). This is what
   names the cache and lets the app detect a new build.
3. Next time she opens the app online, it fetches the new version and shows an
   **"A new version is ready — Refresh"** prompt. The version is shown in **Settings** so
   she can confirm she's current.

---

## How it's built (for whoever maintains it)

```
index.html                app shell host
manifest.webmanifest      install / icons / standalone display
sw.js                     service worker (offline + clean updates)
version.js                THE version string — bump on every deploy
assets/styles.css         all styling (iPad-first, light/dark)
assets/icons/             app icons

core/                     durable shared layer (rarely changes)
  app.js                  bootstrap: SW, install gate, migrations, mount
  shell.js                header/nav, hosts the active feature, backup reminder
  registry.js             feature registry (the seam for future building blocks)
  db.js                   IndexedDB: atomic, error-propagating CRUD
  migrations.js           data-model versioning
  backup.js               export/import (the durability net)
  images.js               receipt photo compression
  settings.js             settings sheet (backup/restore/version/storage)
  ui.js                   pure money/date helpers + DOM helpers + toast
  overlay.js              modal sheet

features/items/           v1 feature: the refund/reimbursement tracker
  items.js                controller (registers the feature)
  model.js                pure logic: statuses, types, store credit, computeSummary (TESTABLE)
  dashboard.js            summary tiles
  item-list.js            grouped register + status stepper + store-credit cards
  item-form.js            add/edit + camera capture + category/reference/credit fields
  categories.js           user-defined category list (add/rename-flows-through/remove)
  cards.js                user-defined card list (which card the refund hits; rename flows through)
  receive-flow.js         "money back vs store credit" chooser on Received
  calendar.js             one-way .ics export (TESTABLE buildICS) + iOS "Add to Calendar"
  receipt-view.js         full-size receipt photo viewer (tap "View receipt" / the thumbnail)

tests.html                zero-dep self tests for the pure logic
```

### Why you can trust it (data integrity)
- The dashboard totals are a **pure function of the full item list**, recomputed every
  render — there's no separate tally that can drift.
- **Nothing is hard-deleted.** "Remove" = status `cancelled`; the item stays, just out of
  the outstanding total.
- Every item is always in exactly one status bucket — nothing can fall into limbo.
- Writes are **atomic** (IndexedDB transactions) and **errors are surfaced**, never
  swallowed — a failed save keeps your input and tells you.

### Reminders & calendar (why it's one-way)
Each item can have an optional **"Expect it back by"** date. The app uses it for **in-app
nudges** — outstanding items show *Expected back / due soon / ⚠ overdue*, and the dashboard
flags how many are past due. This is the real reminder, and it's always correct because it's
all on one device.

There's also a one-tap **📅 Add to Calendar** on any waiting item with a date. It generates a
standard `.ics` and hands it to iOS, which shows its own *Add to Calendar* sheet where she
**picks the calendar/group**. The event includes a 9 a.m. alert on the expected date.

This is deliberately **one-way (app → calendar)**. A web app has **no API to read or write
the iOS Calendar**, so the app can never see edits made to the calendar event. True two-way
sync would require either a **server** talking to iCloud over CalDAV (a paid, account-based
service) or a **native App Store app** ($99/yr + review) — both of which break this project's
free / no-server / no-account guarantees. So the app stays the source of truth; the calendar
entry is a convenience copy. If a date changes, change it in the app and re-tap Add to Calendar.

### Adding a future building block
Drop a folder under `features/`, and call `registerFeature({ id, label, icon, mount })`.
It appears as a new tab automatically — no changes to the shell, no build step.

---

## Roadmap (later building blocks)
Bank/CSV import → auto-matching incoming refunds to outstanding items → richer
categorization → reports → checkbook balancing. Each ships as a pushed update.
