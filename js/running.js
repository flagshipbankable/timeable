// The "On the clock" bar shown on every screen while a timer runs, and the
// one-second ticker that keeps live times up to date.
//
// Live numbers are worked out from the saved start time on each tick, never
// counted up, so they stay right after the phone sleeps or the app is closed.

import { esc, toast } from './ui.js';
import * as store from './store.js';
import { entryMs, formatClock, formatHM, formatTime } from './time.js';
import { openEntryForm } from './entry-forms.js';
import { floorMinute, planFinish } from './timeline.js';

let running = null;
let timer = null;
const bar = () => document.getElementById('running');

export function currentRunning() {
  return running;
}

// Updates every element marked for live time:
//   data-live="clock"  → 1:05:09 for the running session
//   data-live="hm" data-base="ms" → finished time plus the running session, as 1h 05m
function tick() {
  const nowMs = Date.now();
  const ms = running ? entryMs(running, nowMs) : 0;
  document.querySelectorAll('[data-live]').forEach((el) => {
    const base = Number(el.dataset.base || 0);
    const add = el.dataset.running === 'yes' ? ms : 0;
    el.textContent = el.dataset.live === 'clock' ? formatClock(ms) : formatHM(base + add);
  });
}

function startTicker() {
  if (timer || !running || document.visibilityState !== 'visible') return;
  timer = setInterval(tick, 1000);
}

function stopTicker() {
  clearInterval(timer);
  timer = null;
}

function renderBar() {
  const el = bar();
  document.body.classList.toggle('has-running', Boolean(running));
  if (!running) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = `<div class="running-inner">
      <div class="running-text">
        <p class="running-label"><span class="pulse" aria-hidden="true"></span>On the clock <span class="running-since">since ${esc(formatTime(running.start))}</span></p>
        <p class="running-name">${esc(running.taskName)}</p>
      </div>
      <p class="running-clock" data-live="clock" aria-label="Time on this session">${formatClock(entryMs(running, Date.now()))}</p>
      <div class="running-actions">
        <button class="button button-soft button-small" type="button" data-bar="edit">Edit</button>
        <button class="button button-small" type="button" data-bar="finish">Finish</button>
      </div>
    </div>`;
  el.querySelector('[data-bar="edit"]').addEventListener('click', () => openEntryForm({ entry: running }));
  el.querySelector('[data-bar="finish"]').addEventListener('click', finishNow);
}

// Finish ends the timer at the current minute. Under a minute isn't kept.
export async function finishNow() {
  const entry = running;
  if (!entry) return;
  try {
    const fresh = await store.getEntry(entry.id);
    if (!fresh || fresh.end || fresh.deleted) return;
    const plan = planFinish(fresh, floorMinute(Date.now()));
    const result = await store.applyChanges(plan.changes);
    const message = plan.tooShort
      ? `${fresh.taskName} was under a minute, so it wasn\u2019t kept.`
      : `Finished ${fresh.taskName} · ${formatHM(entryMs(result.written[0], Date.now()))}`;
    toast(message, {
      action: 'Undo',
      onAction: () => store.undoChanges(result.undo).catch((error) => toast(error.message)),
    });
  } catch (error) {
    toast(error.message);
  }
}

// Reloads the running session from storage and redraws the bar.
export async function refreshRunning() {
  running = await store.getRunningEntry();
  renderBar();
  stopTicker();
  startTicker();
  tick();
}

export function startRunningBar() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tick(); startTicker(); } else stopTicker();
  });
  return refreshRunning();
}

// Re-runs the ticker right after a screen draws, so new live numbers
// don't wait up to a second.
export function tickNow() {
  tick();
}

