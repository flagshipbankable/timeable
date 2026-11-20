# timeable

A running work-time log. Tap a task to clock in as the day goes, then use the
day's view to enter time into an office timesheet portal quickly and
accurately.

**Live app:** https://flagshipbankable.github.io/timeable/

**Status:** early build. The code book, tasks, backups, the timer, and sync
between devices work. The portal view (rounded lines with copy buttons) and
weekly totals arrive next. See `CLAUDE.md` for the full plan.

## Install on iPhone

1. Open the live app in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Leave **Open as Web App** on, then tap **Add**.
4. From then on, open timeable from the Home Screen. iPhone keeps the Home
   Screen app's data separate from Safari's.

## Your data

timeable keeps everything on your device. Export a backup regularly from
Settings (on iPhone, choose Save to Files), and always before deleting or
reinstalling the app.

**Optional sync** keeps two devices in step through your own **private**
GitHub repo. Everything is encrypted on the device first (AES-GCM, with a key
made from a passphrase only you know), so the repo only holds scrambled
files. Each device needs the repo's name, a fine-grained token that can reach
only that repo (Contents: Read and write), and the passphrase. The app can
connect only to its own site and GitHub's API, and nothing else. Set it up in
Settings → Sync.

## Built with

Plain HTML, CSS, and JavaScript, with no build step, hosted on GitHub Pages.
Built with Claude.
