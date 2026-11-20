// timeable: app start-up, navigation, and banners.

import { icons } from './icons.js';
import { esc, isIOS, isStandalone, prefs, toast, todayLabel } from './ui.js';
import { formatDay, formatTime, localDate } from './time.js';
import { onMerged, onStatus, startSync } from './sync.js';
import { refreshRunning, startRunningBar } from './running.js';
import { applyUpdate, startServiceWorker } from './sw-client.js';
import * as desk from './views/desk.js';
import * as day from './views/day.js';
import * as week from './views/week.js';
import * as tasks from './views/tasks.js';
import * as settings from './views/settings.js';
import * as codes from './views/codes.js';
import { onChange } from './store.js';

const VIEWS = [
  { id: 'desk', label: 'Desk', icon: 'desk', view: desk },
  { id: 'day', label: 'Day', icon: 'day', view: day },
  { id: 'week', label: 'Week', icon: 'week', view: week },
  { id: 'tasks', label: 'Tasks', icon: 'tasks', view: tasks },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings },
];

// Screens that aren't tabs. "nav" says which tab stays highlighted.
const SUB_VIEWS = [
  { id: 'codes', label: 'Code book', nav: 'settings', view: codes },
];

const $ = (selector) => document.querySelector(selector);

function renderNav() {
  const link = (v, cls, size) =>
    `<a class="${cls}" href="#${v.id}" data-nav="${v.id}">${icons[v.icon](size)}<span>${v.label}</span></a>`;
  $('.tabbar').innerHTML = VIEWS.map((v) => link(v, 'tab', 22)).join('');
  $('.desktop-nav').innerHTML = VIEWS.map((v) => link(v, '', 18)).join('');
}

function currentView() {
  const id = window.location.hash.slice(1);
  return VIEWS.find((v) => v.id === id) || SUB_VIEWS.find((v) => v.id === id) || VIEWS[0];
}

function show({ moveFocus }) {
  const entry = currentView();
  const main = $('#view');
  // Each render gets a fresh container. If Josh switches screens before a
  // slow screen finishes loading, it fills a container that's no longer
  // shown instead of overwriting the new screen.
  const container = document.createElement('div');
  main.replaceChildren(container);
  Promise.resolve(entry.view.render(container)).catch((error) => {
    console.error(error);
    container.innerHTML = '<section class="card"><h2>Something went wrong</h2><p>This screen didn’t load. Try again, and if it keeps happening, export a backup and report it.</p></section>';
  });
  const navId = entry.nav || entry.id;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === navId) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = entry.id === 'desk' ? 'timeable' : `${entry.label} · timeable`;
  if (moveFocus) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
}

let shownDate = localDate();

function updateDate() {
  $('#today-label').textContent = todayLabel();
}

// After midnight, "today" moves on: refresh the date and the screen.
function checkDate() {
  const date = localDate();
  if (date === shownDate) return;
  shownDate = date;
  updateDate();
  show({ moveFocus: false });
}

function addBanner(id, html) {
  if (document.getElementById(id)) return null;
  const banner = document.createElement('div');
  banner.id = id;
  banner.className = 'banner';
  banner.innerHTML = html;
  $('#banners').append(banner);
  return banner;
}

function showUpdateBanner() {
  const banner = addBanner('update-banner',
    `<p><strong>Update available.</strong> Tap to load the new version.</p>
     <button class="button" type="button">${icons.refresh(18)} Update</button>`);
  if (!banner) return;
  banner.classList.add('banner-update');
  // If Settings is open from a manual check, keep its message in step.
  const status = document.getElementById('update-status');
  if (status) status.textContent = 'A new version is ready. Tap Update at the top.';
  const button = banner.querySelector('button');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Updating…';
    if (!applyUpdate()) window.location.reload();
  });
}

// iOS has no automatic install prompt, so Safari users get a short hint.
function maybeShowInstallHint() {
  if (!isIOS() || isStandalone() || prefs.get('installHintDismissed', false)) return;
  const banner = addBanner('install-banner',
    `<p>Install timeable: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. <a href="#settings">Steps</a></p>
     <button class="icon-button" type="button" aria-label="Dismiss install hint">${icons.close(20)}</button>`);
  if (!banner) return;
  banner.querySelector('button').addEventListener('click', () => {
    prefs.set('installHintDismissed', true);
    banner.remove();
  });
}

// A banner on every screen while sync is stopped by something only Josh
// can fix (an expired token, a changed passphrase). Problems that fix
// themselves, like being offline, only show in Settings.
function updateSyncBanner(status) {
  const problem = status.state !== 'off' && status.problem && status.problem.needsAction ? status.problem : null;
  const existing = document.getElementById('sync-banner');
  if (!problem) {
    if (existing) existing.remove();
    return;
  }
  const html = `<p><strong>Sync stopped.</strong> ${esc(problem.text)}</p>
     <a class="button button-small" href="#settings">Fix</a>`;
  if (existing) existing.innerHTML = html;
  else addBanner('sync-banner', html);
}

// After the other device's changes arrive: say so only when something
// needs a look, so a normal sync stays quiet.
function announceMerge({ fixes, overlapDates }) {
  const parts = fixes.map((f) => (f.after.deleted
    ? `${f.before.taskName} was started the same minute as ${f.kept.taskName} on your other device, so it was removed`
    : `Two timers were running, so ${f.before.taskName} now ends at ${formatTime(f.after.end)}`));
  if (overlapDates.length) {
    const days = overlapDates.map((d) => formatDay(d)).join(', ');
    parts.push(`Time from both devices overlaps on ${days}`);
    toast(`${parts.join('. ')}.`, {
      action: 'Review',
      duration: 12000,
      onAction: () => day.showDate(overlapDates[0]),
    });
  } else if (parts.length) {
    toast(`${parts.join('. ')}.`, { duration: 8000 });
  }
}

renderNav();
updateDate();
// The running session loads first, so live times on the first screen use it.
startRunningBar().catch((error) => console.error(error)).finally(() => show({ moveFocus: false }));
onStatus(updateSyncBanner);
onMerged(announceMerge);
startSync().catch((error) => console.error(error));
maybeShowInstallHint();
window.addEventListener('hashchange', () => show({ moveFocus: true }));
// Saved data changed: refresh the running bar and redraw the current
// screen so both show the new state.
onChange(() => {
  refreshRunning().catch((error) => console.error(error)).finally(() => show({ moveFocus: false }));
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkDate();
});
setInterval(checkDate, 60 * 1000);
startServiceWorker({ onUpdateReady: showUpdateBanner });
