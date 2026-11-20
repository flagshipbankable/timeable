# timeable — CLAUDE.md

Spec and working rules for Claude in this repo. **Public file:** no names,
credentials, employer details, job codes, client names, or real data. Use
placeholders.

**Status:** Approved Nov 14, 2026. v0.3.1 (Phases 1–3, including Josh's
review changes) published Nov 14, 2026. (0.3.0 was never published.)
Plan changed Nov 19, 2026: sync moves up to Phase 4 and goes through a private
GitHub repo with on-device encryption; portal lines move to Phase 5; coworkers
are set aside. Phase 4 (0.4.0) published Nov 20, 2026; waiting for Josh to
create the data repo and check sync on his iPhone and laptop. Phase 5 starts
when Josh says go.

## 1. Overview

- **What it does:** a running work-time log. Tap a task to clock in, switch or
  finish as the day goes, then use the day's view to enter time into the
  office's web timesheet portal quickly and accurately. The portal has no
  import, so timeable's job is making manual entry fast and error-free.
- **Who uses it:** the owner only, for now (decided Nov 19). Coworkers are set
  aside.
- **Devices:** iPhone (main, installed from the Home Screen) and a work laptop
  browser (where time gets entered into the portal). Sync between them comes
  in Phase 4.
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
- The Desk lists tasks as full-width rows (favorites first, then A–Z), each
  showing its code and client, so every task stays in the same spot (Josh,
  Nov 14).
- **Press and hold** a task (about half a second, while a ring fills) to clock
  in. A quick tap only shows a hint, and sliding or scrolling cancels, so a
  stray tap never starts the wrong timer (Josh, Nov 14). Enter or Space on a
  keyboard starts right away.
- Starting has no Undo. Finishing, deleting, and adjusting overlaps do.
- Each row's ⋯ button has "Start at…" with quick chips (Now, 5, 10, 15 min
  ago) and a live preview of what will change, a client for this session,
  notes, "Add past time for this task", and "Edit task".
- Tapping a new task ends the running one at the new start time.
- A task whose code is retired can't be clocked into until it gets a new code.
- An "On the clock" banner on every screen, with a live timer and Edit and
  Finish buttons. It sits above the tab bar on phones.
- Custom (one-off) entries that aren't tied to a task. Their service code is
  optional so time can be captured fast and sorted out later.
- Add past time with a work date, start and end, and overnight handling.
- Edit any field, or delete. Editing other fields never shifts a session's
  start and end. Editing the running session offers quick finish chips.
- Times are saved to the whole minute, so what's shown is what's counted.
  A session under a minute isn't kept (for example, a wrong task fixed in
  the same minute).
- **No minute ever counts for two sessions** (Josh, Nov 14). Overlaps are
  adjustments, not warnings:
  - Ending the running timer at a new start happens on its own.
  - Any other overlap opens **Adjust overlapping time**, showing before and
    after timelines and every change in words. Its two options:
    1. Keep the new time and change the other time (trim, split, end, or
       remove it).
    2. Keep the other time and fit the new time around it (start later,
       shorten it, or fill the free gaps). If there's no free time, this
       option is shown as not possible, with the reason.
  - Go back returns to the form with nothing saved.
  - Forms preview overlaps while you type.
  - The store refuses any save that would double-count minutes, and Undo
    refuses if the time has been used again since.
- When a session is split, travel, prep, miles, destination, and expenses
  stay on the first piece so they're never counted twice.
- Sessions that already overlap (from older data or an imported backup) are
  flagged on the Day screen. Saving one opens Adjust.
- A session that runs past midnight counts on the day it started.
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

**Sync between iPhone and laptop** (Phase 4; plan drafted Nov 19)
- Each device saves every change locally first, with the same
  no-double-counting checks, and works fully offline. Sync copies changes
  between devices through a **private data repo** on GitHub that Josh creates.
- **Everything is encrypted on the device** before it leaves, with a key made
  from a passphrase only Josh knows. GitHub stores only scrambled files. File
  names and commit messages carry no record details.
- Each device needs three things, entered once in Settings → Sync: the data
  repo's name, a GitHub token that can reach only that repo, and the
  passphrase. A wrong passphrase is caught and named, never applied.
- Settings → Sync shows when it last synced, how many changes are waiting,
  and any problem in plain words, with a "Sync now" button and "Turn off sync
  on this device" (keep or remove this device's copy).
- Sync runs when the app opens or comes back on screen, shortly after a
  change, and about once a minute while open. Changes made offline wait and
  go up later.
- Each device writes only its own small change files, so devices never
  overwrite each other. Old change files are tidied into one summary file
  from time to time so the repo stays small.
- Merging: for each task, session, or checkmark, the most recent change wins.
  Deletes sync too. Merging never quietly removes time.
- Two timers running after a merge: the later start keeps running. The
  earlier one ends where the next session after it begins (usually the other
  timer's start), the same as switching tasks. A timer started in the very
  same minute as the kept one has no time, so it's removed, and the app says
  so. Any other overlap is flagged on the Day screen and fixed with Adjust,
  exactly like overlaps from old data; a message with a Review button opens
  that day.
- Problems Josh must fix (an expired token, a changed passphrase, a public
  repo) stop automatic syncing and show a banner on every screen with a Fix
  link. Problems that fix themselves (offline, GitHub busy) only show in
  Settings, and sync retries on its own.
- Backups never include the token or sync settings. Importing a backup with
  sync on sends its records and re-reads the repo, so the newest copy of each
  record wins on both devices.
- Setting up a second device that already has data merges both sides.
- Lose the passphrase and the GitHub copy can't be read. Each device's copy
  and backups still hold everything, and sync can be set up again with a new
  passphrase.

**App basics**
- Installs to the Home Screen, works offline, and shows an update prompt.
- Export and import a full backup file.
- All dates and "today" use the device's local time zone.

### Later (agreed, not now)
- **Coworkers** (set aside Nov 19): each person would get a private log and
  one shared code book. Sync would likely switch to Firebase then, so all
  sync code stays in `js/sync.js` to keep that switch contained.
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
- **Sync design:** the local store stays the source of truth on each device,
  and `js/sync.js` mirrors it through the GitHub REST API (Contents endpoints).
  Encryption uses the browser's built-in Web Crypto (AES-GCM, with the key
  derived from the passphrase). Check GitHub's and MDN's current docs before
  writing each part.
- **Outside requests:** none except `api.github.com`, only to Josh's own data
  repo, only once sync is set up, and only encrypted data. `index.html` sets a
  Content Security Policy (a `<meta>` tag, since GitHub Pages can't send the
  header) so the page can connect only to this site and `api.github.com`.
  Per MDN, a page's policy doesn't govern its service worker; `sw.js` only
  ever handles this site's own files. Styles allow inline `style` attributes
  (bar widths); images, scripts, and connections don't.
- **Sync details (0.4.0):** GitHub REST API version `2026-03-10`; files read
  by fingerprint through `git/blobs` (raw); every read asks GitHub fresh
  (`cache: 'no-cache'`, so unchanged answers are free 304s); writes one at a
  time with a 1-second gap; PBKDF2-SHA-256 at 600,000 rounds (OWASP); gzip
  before encrypting. Repo layout: `timeable-sync.json` (salt and check value,
  not secret), `changes/<device>_<number>.bin`, `snapshot.bin`.

**Data model** (schema version 1)

| Record | Fields |
|---|---|
| codebook | version, importedAt, codes[] {code, label, billable, active}, clients[] |
| task | id, name, code, client, summary, favorite, updatedAt, deleted |
| entry | id, workDate, start, end (empty while running), taskId, taskName, code, codeLabel, billable, client, notes, travelHours, prepHours, miles, destination, expenses, updatedAt, deleted |
| portalMark | workDate + line key, entered, enteredAt, updatedAt |
| settings | week start, weekly target |

Sync bookkeeping lives in the existing `meta` store, so Phase 4 needed no
change to saved records and no migration: `sync` (repo, token, `cryptoKey`,
device ID), `syncState` (file number, files read, last sync), and one
`outbox:<store>:<id>` note per record changed here and not yet sent.

## 5. File layout

```
timeable/
├── index.html              the app page and shell
├── manifest.webmanifest    name, icons, colors
├── sw.js                   service worker: offline cache, updates, VERSION
├── css/app.css             all styles (phone first; desktop from 900px)
├── js/app.js               start-up, navigation, banners
├── js/sw-client.js         service worker registration and update flow
├── js/store.js             the only file that reads and writes saved data
├── js/codebook.js          code book checks, change preview, applying changes
├── js/backup.js            backup checks, export (Share sheet or download)
├── js/sheet.js             pop-up panels for forms and confirmations
├── js/ui.js                shared helpers: escaping, toasts, settings
├── js/icons.js             inline SVG icons
├── js/time.js              local dates, weeks, durations, time formats
├── js/entries.js           entry copies from tasks, totals, overlap checks
├── js/fields.js            shared form fields: code, client, extras
├── js/entry-forms.js       start options, one-off timer, past time, edit
├── js/running.js           the "On the clock" bar and live timer
├── js/timeline.js          the no-double-counting rule: overlaps and plans
├── js/adjust.js            saving time safely; the Adjust overlapping time sheet
├── js/crypto.js            encryption with Josh's passphrase (Phase 4)
├── js/sync.js              all sync: the data repo, change files, merging (Phase 4)
├── js/views/               one file per screen: desk, day, week, tasks,
│                           settings, codes (code book editor, #codes),
│                           and sync-settings (the Sync section of Settings)
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

**Client data boundary (Josh, Nov 19).** Claude may use general tools, this
repo, sample data, and the code book. Claude must never have access to, or
the ability to reach, client names, client data, or client information.
- Client details live only on Josh's devices, in his backup files, and in
  the private data repo (encrypted). Nowhere else.
- The Claude GitHub app is limited to the repos Claude works on (this one and
  a throwaway test repo). The data repo is never attached to a Claude session.
- Claude never asks for or receives the data repo's contents, its token, the
  passphrase, a backup file, or screenshots that show client details.
  Feedback uses sample data, or screenshots cropped or blurred first.
- Tests use made-up sample data: a local stand-in for GitHub for most sync
  tests, and the throwaway test repo for a final real check.
- Any change to what the app is allowed to connect to is called out in the
  release notes.

## 8. Phases

### Phase 1 — Foundation
- [x] App shell with tabs: Desk, Day, Week, Tasks, Settings (empty states)
- [x] Manifest, icons, Apple touch icon, safe-area layout
- [x] Service worker with offline caching; update prompt; version in Settings
- [x] "How to install" hint
- [x] `.nojekyll`, README
- [x] Test: phone, narrow, and desktop screenshots; offline reload; update prompt
- [x] Josh's iPhone check after publishing (Nov 14, 2026)

### Phase 2 — Code book, tasks, and backup
- [x] `store.js` (IndexedDB, schema version 1, all five stores created now)
- [x] Code book import with change preview; edit in Settings
- [x] Task create, edit, delete, and star; "needs a new code" flag
- [x] Backup export and import with validation
- [x] Test: import a sample code book, build tasks, export, clear, import
- [x] Josh's iPhone check after publishing (Nov 14, 2026: update, code book load, tasks, Share sheet export, storage protection granted)

### Phase 3 — Timer and entries
- [x] Clock in, start at, switch, finish; running banner
- [x] Custom entries; add past time; edit and delete
- [x] Today and this-week totals on the Desk
- [x] Settings: reword "Protected from clean-up" so it reads as a status, not a setting (Josh, Nov 14)
- [x] Desk redesign: full-width rows, one-tap clock-in with Undo, ⋯ options (Josh, Nov 14)
- [x] Day tab: the day's sessions with date navigation (portal lines come in Phase 5)
- [x] Test: timer survives reload and app close; switching; overnight entries
- [x] Josh's review of 0.3.0 (Nov 14): press-and-hold, no double-counted minutes, Adjust overlapping time, quick time chips, whole minutes
- [x] Test: every overlap shape, 3,000 random timelines, store guard, stale Undo, old overlapping data
- [ ] Josh's iPhone check after publishing

### Phase 4 — Sync (private GitHub repo, encrypted) — 0.4.0
- [x] Plan agreed with Josh (Nov 20)
- [x] Josh: Claude GitHub app set to "Only select repositories" (timeable,
      timeable-sync-test), confirmed Nov 20
- [x] Josh: create the throwaway test repo (sample data only)
- [x] Content Security Policy: this site and `api.github.com` only
- [x] Encryption with the passphrase; wrong-passphrase check
- [x] Settings → Sync: set up, status, Sync now, turn off on this device;
      new token, new passphrase, start over
- [x] Encrypted change files up and down; offline queue; tidy-up
- [x] Merging: newest change wins, deletes, two running timers, overlap flags
- [x] Test: three simulated devices against a local stand-in for GitHub
      (77 checks: offline, wrong passphrase, bad token, rate limit, tidy,
      start over, backups); 15 unit checks; upgrade from live 0.3.1 (56)
- [x] Test: real GitHub reads with the throwaway test repo (11 checks).
      Writes through GitHub's file API and the browser's CORS pre-check
      couldn't run from the workspace (its proxy blocks them); Josh's first
      setup is their first real run.
- [ ] Josh: create the private data repo and its token (steps from Claude)
- [ ] Josh's check on the iPhone and work laptop together

### Phase 5 — Ready for the portal — 0.5.0
- [ ] Day view with portal lines, rounding, copy buttons, entered checkmarks
- [ ] Billable / Non-billable / Total header
- [ ] Week view with payroll-style totals
- [ ] Test: a sample week matches hand-calculated totals

### Coworkers — set aside Nov 19
- [ ] Only if Josh brings it back: plan sign-in, sync service, shared code book

## 9. Release notes
- 0.1.0 — Nov 14, 2026 — Foundation: app shell with five screens, Home
  Screen install, offline use, and the update prompt.
- 0.2.0 — Nov 14, 2026 — Code book import with change preview and editor,
  tasks with favorites and "needs a new code" flags, backup export and
  import, and storage protection.
- 0.3.0 — Nov 14, 2026 — Timer: one-tap clock-in with Undo, switching,
  Start at, the "On the clock" bar with Edit and Finish, one-off timers, past
  time with overnight handling, editing and deleting sessions, overlap
  warnings, Today and This week totals, the Day tab's session list, and the
  "Storage protection: On" wording. (Built and reviewed; not published.)
- 0.3.1 — Nov 14, 2026 — Josh's review: press and hold to clock in, times
  saved to the whole minute, and no minute counted twice. Overlaps now open
  "Adjust overlapping time" with clear options instead of a warning. Also
  quick start and finish chips, live previews, Undo for adjustments, and
  overlap flags on the Day screen.
- 0.4.0 — Nov 20, 2026 — Sync between iPhone and laptop through a private
  GitHub repo, encrypted on the device with Josh's passphrase. Set up, status,
  Sync now, and turn off in Settings; banners for problems that need a fix;
  newest change wins; two running timers resolved; overlaps flagged with a
  Review button. **Connections:** the app can now reach `api.github.com`
  (only Josh's data repo, only once sync is set up); a Content Security
  Policy blocks every other site.
