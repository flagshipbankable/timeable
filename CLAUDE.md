# timeable — CLAUDE.md

Spec and working rules for Claude in this repo. **Public file:** no names,
credentials, employer details, job codes, client names, or real data. Use
placeholders.

**Status:** Approved Nov 14, 2026. Phase 1 built and tested in headless
Chrome; waiting for Josh's go-ahead to publish.

## 1. Overview

- **What it does:** a running work-time log. Tap a task to clock in, switch or
  finish as the day goes, then use the day's view to enter time into the
  office's web timesheet portal quickly and accurately. The portal has no
  import, so timeable's job is making manual entry fast and error-free.
- **Who uses it:** the owner first. Coworkers may use it later, each with their
  own private log.
- **Devices:** iPhone (main, installed from the Home Screen) and a work laptop
  browser (where time gets entered into the portal). Sync between them comes
  in Phase 5.
- **Replaces:** an earlier version built on another platform. That version
  stays in use until this one has sync.
- **Version 1 is done when:** logging on the phone and entering a full week
  into the portal from the laptop works without the old version.

## 2. How the portal works (what timeable must produce)

Each portal line has: **Client**, **Service code**, **Hours**, **Travel
hours**, **Preparation hours**, **Miles**, **Destination** (optional),
**Expenses**, **Date**, and **Activity summary** (required).

- Hours are decimals in **quarter hours** (0.25 = 15 minutes).
- Client is one of two standard choices from the code book, or a specific
  client's name typed in.
- A day usually has several lines, and the same service code can appear on
  more than one line (one per kind of activity).
- The portal shows each day's **Billable / Non-billable / Total** hours.
  Billable status comes from the service code.
- The portal has named templates. timeable's tasks use the same names, so the
  matching template can be applied in the portal.
- Payroll uses a weekly export. timeable's week view shows the same totals:
  Billable, Non-billable, Hours, Travel, Prep, Total, and Miles.

## 3. Features

### Version 1 (must have)

**Code book**
- The list of service codes and client choices lives in a **code book file**
  loaded into the app. It is never in this repo.
- Code book file format (JSON):
  `{ "format": "timeable-codebook", "formatVersion": 1, "updated": "YYYY-MM-DD",
  "codes": [ { "code": "9100", "label": "Sample - Category", "billable": true } ],
  "clients": [ "Sample Client A", "Sample Client B" ] }`
- Client picker: the code book's standard choices, plus a box to type a
  specific client's name.
- Import a new code book file, with a preview of what changed (added, renamed,
  retired) before applying it.
- Edit codes in Settings for small changes.
- Retired codes leave the pickers but stay on old entries. Tasks pointing to a
  retired code are flagged "needs a new code."

**Tasks** (named to match the portal's templates)
- Each task has: name, service code, default client, and default activity
  summary.
- Star favorites. Favorites come first, then alphabetical.
- Editing a task never changes past entries.

**Timer and entries**
- Tap a task to clock in. "Start at…" backdates the start.
- Tapping a new task ends the running one at the new start time.
- An "On the clock" banner on every screen, with a live timer and Edit and
  Finish buttons.
- Custom (one-off) entries that aren't tied to a task.
- Add past time with a work date, start and end, and overnight handling.
- Edit any field, or delete.
- Every entry keeps a copy of its task name, service code, code label, and
  billable status from the moment it was logged.
- Optional per-entry fields: client (if different from the task's), notes for
  the activity summary, travel hours, prep hours, miles, destination, and
  expenses.

**Day view: "Ready for the portal"**
- One **portal line** per task per day (approved). Sessions are logged to the
  exact minute. All of a task's sessions that day are added up, and only that
  total gets rounded. Example: a 4-minute call, a 20-minute call, and 90
  minutes of calls under one task make one line of 114 minutes, which
  becomes 2.00 hours.
- Each line shows client, service code, rounded hours, travel, prep, miles,
  expenses, and an activity summary built from the task's default plus that
  day's notes.
- **Rounding (approved):** round each line's total to the nearest quarter hour.
  Exactly halfway (7.5 minutes past a quarter) rounds up.
- A line that rounds to 0.00 (under 7.5 minutes for the day) stays visible
  and is flagged, so short time never disappears silently. Josh decides what
  to do with it.
- Client on a line: the task's default, unless sessions that day used a
  different client. Different clients make separate lines.
- Copy buttons for each field, and a checkmark for "entered in portal" on each
  line.
- If an entered line changes later, ask whether to keep the checkmark.
- Day header shows Billable / Non-billable / Total from the rounded lines,
  exactly as the portal will show them, plus the unrounded total for
  comparison.

**Week view**
- Each day's total, with checkmark progress per day.
- Weekly totals matching the payroll export, measured against a 40-hour target
  (Monday–Sunday).

**App basics**
- Installs to the Home Screen, works offline, and shows an update prompt.
- Export and import a full backup file.
- All dates and "today" use the device's local time zone.

### Later (agreed, not now)
- **Phase 5 — sync** across devices through Firebase (Google), with sign-in.
- **Phase 6 — coworkers:** each person gets a private log, and one shared code
  book is managed by the owner.
- Optional encryption of client and summary fields before they sync.
- Option to combine lines by service code instead of by task.
- Suggestions from recently typed client names.
- Export in the payroll spreadsheet's layout.
- Reminders, such as "timer still running at 6 PM."

### Not doing
- Sending anything to the portal directly. It has no import.
- Office manager or shared reports.

## 4. Tech choices

- Static files, no build step, hosted on GitHub Pages.
- Plain JavaScript modules. Preact with HTM only if screens get complex, with
  Josh's approval.
- **Storage:** IndexedDB through `js/store.js`. localStorage only for small
  settings.
- **Sync-ready from day one:** every record has a random unique ID, an
  `updatedAt` time, and a `deleted` flag in place of hard deletes.
- **Phase 5 decision, made then:** whether Firestore's offline cache becomes
  the store, or the local store stays and a sync module mirrors it. Check
  Firebase's current docs first.
- **Outside requests:** none until Phase 5. Then Firebase only, sending the
  signed-in user's own records.

**Data model** (schema version 1)

| Record | Fields |
|---|---|
| codebook | version, importedAt, codes[] {code, label, billable, active}, clients[] |
| task | id, name, code, client, summary, favorite, updatedAt, deleted |
| entry | id, workDate, start, end (empty while running), taskId, taskName, code, codeLabel, billable, client, notes, travelHours, prepHours, miles, destination, expenses, updatedAt, deleted |
| portalMark | workDate + line key, entered, enteredAt, updatedAt |
| settings | week start, weekly target |

## 5. File layout

```
timeable/
├── index.html              the app page and shell
├── manifest.webmanifest    name, icons, colors
├── sw.js                   service worker: offline cache, updates, VERSION
├── css/app.css             all styles (phone first; desktop from 900px)
├── js/app.js               start-up, navigation, banners
├── js/sw-client.js         service worker registration and update flow
├── js/ui.js                shared helpers: escaping, dates, small settings
├── js/icons.js             inline SVG icons
├── js/views/               one file per screen: desk, day, week, tasks, settings
├── icons/                  app icons: 192, 512, maskable 512, Apple 180
├── .nojekyll               serve files as-is on GitHub Pages
├── README.md
└── CLAUDE.md
```

New files must be added to the `ASSETS` list in `sw.js`, or they won't work
offline.

## 6. Code style

- Plain JavaScript modules, small functions, comments that explain why.
- One job per file. `store.js` is the only file that touches saved data.
- Time math uses exact timestamps. Rounding happens only when building portal
  lines.

## 7. Working rules

- Stop at the end of every phase for Josh to test. Don't start the next phase
  until he says so.
- Ask before pushing to main. Main is the live app.
- Bump the version in `sw.js` on every release, and add a release-notes line.
- Check current official docs before using any library or browser feature.
- Phone first. Check desktop after every layout change.
- Never change the data model without a migration tested on sample data.
- Never put job codes, client names, or employer details in this repo. Sample
  data uses made-up codes like `9100 Sample - Category`.

## 8. Phases

### Phase 1 — Foundation
- [x] App shell with tabs: Desk, Day, Week, Tasks, Settings (empty states)
- [x] Manifest, icons, Apple touch icon, safe-area layout
- [x] Service worker with offline caching; update prompt; version in Settings
- [x] "How to install" hint
- [x] `.nojekyll`, README
- [x] Test: phone, narrow, and desktop screenshots; offline reload; update prompt
- [ ] Josh's iPhone check after publishing

### Phase 2 — Code book, tasks, and backup
- [ ] `store.js` (IndexedDB, schema version 1)
- [ ] Code book import with change preview; edit in Settings
- [ ] Task create, edit, delete, and star; "needs a new code" flag
- [ ] Backup export and import with validation
- [ ] Test: import a sample code book, build tasks, export, clear, import

### Phase 3 — Timer and entries
- [ ] Clock in, start at, switch, finish; running banner
- [ ] Custom entries; add past time; edit and delete
- [ ] Today and this-week totals on the Desk
- [ ] Test: timer survives reload and app close; switching; overnight entries

### Phase 4 — Ready for the portal
- [ ] Day view with portal lines, rounding, copy buttons, entered checkmarks
- [ ] Billable / Non-billable / Total header
- [ ] Week view with payroll-style totals
- [ ] Test: a sample week matches hand-calculated totals

### Phase 5 — Sync (Firebase)
- [ ] Plan agreed with Josh first: sign-in method, store design, Firebase setup steps
- [ ] Sign-in, sync, offline queue, conflict handling
- [ ] Test on iPhone and the work laptop together

### Phase 6 — Coworkers
- [ ] Plan agreed with Josh first: who can sign in, shared code book

## 9. Release notes
- 0.1.0 — Nov 14, 2026 — Foundation: app shell with five screens, Home
  Screen install, offline use, and the update prompt.
