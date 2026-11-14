// Desk: today's totals and the task list. Press and hold a task to clock in.

import { icons } from '../icons.js';
import { esc, heading, prefs, toast } from '../ui.js';
import * as store from '../store.js';
import { findCode, taskNeedsCode } from '../codebook.js';
import { entryFromTask, totals } from '../entries.js';
import { entryMs, formatClock, formatHM, localDate } from '../time.js';
import { floorMinute } from '../timeline.js';
import { openCustomStart, openEntryForm, openStartSheet, startSession } from '../entry-forms.js';
import { tickNow } from '../running.js';
import { openTaskForm, sortTasks } from './tasks.js';

export const weeklyTargetHours = () => Number(prefs.get('weeklyTargetHours', 40)) || 40;

// How long a press has to last to clock in (Josh chose press-and-hold so a
// stray tap never starts the wrong timer).
export const HOLD_MS = 500;

function totalsCard(entries, running) {
  const nowMs = Date.now();
  const t = totals(entries, nowMs);
  const today = localDate(new Date(nowMs));
  const runningMs = running ? entryMs(running, nowMs) : 0;
  // Live numbers: finished time is fixed, the running session is added each second.
  const todayRuns = running && running.workDate === today;
  const weekRuns = running && running.workDate >= t.monday && running.workDate <= today;
  const todayBase = t.todayMs - (todayRuns ? runningMs : 0);
  const weekBase = t.weekMs - (weekRuns ? runningMs : 0);
  const target = weeklyTargetHours();
  const pct = Math.min(100, Math.round((t.weekMs / (target * 3600000)) * 100));
  return `<section class="card totals" aria-label="Totals">
      <div class="totals-grid">
        <a class="total" href="#day">
          <span class="total-label">Today</span>
          <span class="total-value" data-live="hm" data-base="${todayBase}" data-running="${todayRuns ? 'yes' : 'no'}">${formatHM(t.todayMs)}</span>
        </a>
        <a class="total" href="#week">
          <span class="total-label">This week</span>
          <span class="total-value" data-live="hm" data-base="${weekBase}" data-running="${weekRuns ? 'yes' : 'no'}">${formatHM(t.weekMs)}</span>
          <span class="total-sub">of ${target}h target</span>
        </a>
      </div>
      <div class="progress" role="progressbar" aria-label="Week progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    </section>`;
}

// The ring that fills while you hold. 2πr for r = 15 is about 94.25.
const holdRing = `<span class="hold-ring" aria-hidden="true"><svg viewBox="0 0 36 36" width="34" height="34">
    <circle class="hold-track" cx="18" cy="18" r="15"/><circle class="hold-fill" cx="18" cy="18" r="15"/></svg>
    <span class="hold-icon">${icons.play(14)}</span></span>`;

function taskRow(task, codebook, running) {
  const needs = taskNeedsCode(task, codebook);
  const isRunning = running && running.taskId === task.id;
  const code = findCode(codebook, task.code);
  const meta = [code ? `${code.code} ${code.label}` : task.code, task.client].filter(Boolean).join(' · ');
  const label = isRunning ? `${task.name}, on the clock` : `${task.name}. Press and hold to clock in.`;
  return `<li class="desk-row${isRunning ? ' is-running' : ''}${needs ? ' needs-code' : ''}">
      <button class="desk-main" type="button" data-start="${esc(task.id)}" aria-label="${esc(label)}">
        <span class="desk-star">${task.favorite ? icons.starFilled(16) : ''}</span>
        <span class="desk-text">
          <span class="desk-name">${esc(task.name)}</span>
          <span class="desk-meta">${esc(meta)}</span>
          ${needs ? `<span class="tag tag-warn">${icons.warn(14)} Needs a new code</span>` : ''}
        </span>
        ${isRunning
          ? `<span class="desk-live"><span class="pulse" aria-hidden="true"></span><span data-live="clock">${formatClock(entryMs(running, Date.now()))}</span></span>`
          : needs ? '' : holdRing}
      </button>
      <button class="icon-button desk-more" type="button" data-more="${esc(task.id)}" aria-label="${esc(`More for ${task.name}`)}">${icons.more(22)}</button>
    </li>`;
}

// Press and hold: the ring fills over HOLD_MS, then the clock starts. Letting
// go early, sliding a finger, or scrolling cancels. A keyboard press (Enter
// or Space) starts right away, since it can't be a stray touch.
function wireHold(button, { onHold, onShortPress }) {
  let timer = null;
  let origin = null;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
    button.classList.remove('is-holding');
    window.removeEventListener('scroll', cancelOnScroll, true);
  };
  const cancelOnScroll = () => stop();
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || timer) return;
    origin = { x: e.clientX, y: e.clientY };
    button.classList.add('is-holding');
    window.addEventListener('scroll', cancelOnScroll, true);
    timer = setTimeout(() => {
      stop();
      button.classList.add('is-held');
      onHold();
    }, HOLD_MS);
  });
  button.addEventListener('pointerup', () => { if (timer) { stop(); onShortPress(); } });
  button.addEventListener('pointercancel', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointermove', (e) => {
    if (timer && origin && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > 12) stop();
  });
  button.addEventListener('contextmenu', (e) => e.preventDefault());
  button.addEventListener('click', (e) => { if (e.detail === 0) onHold(); });
}

// Two holds in a row can't both start: the second waits for the first.
let starting = false;

async function holdStart(task, tasks, codebook) {
  if (starting) return;
  if (taskNeedsCode(task, codebook)) {
    toast(`“${task.name}” needs a new code first.`, { action: 'Fix', onAction: () => openTaskForm(task, codebook, tasks) });
    return;
  }
  starting = true;
  try {
    const current = await store.getRunningEntry();
    if (current && current.taskId === task.id) {
      toast(`Already on the clock for ${task.name}.`);
      return;
    }
    await startSession(entryFromTask(task, codebook, { start: new Date(floorMinute(Date.now())) }));
  } catch (error) {
    toast(error.message);
  } finally {
    starting = false;
  }
}

export async function render(el) {
  const [codebook, tasks, entries, running] = await Promise.all([
    store.getCodebook(), store.listTasks(), store.listEntries(), store.getRunningEntry(),
  ]);

  const actions = `<div class="desk-actions">
      <button class="button button-soft" type="button" data-custom>${icons.play(18)} Clock in on something else</button>
      <button class="button button-soft" type="button" data-past>${icons.clockPlus(18)} Add past time</button>
    </div>`;

  if (!codebook || tasks.length === 0) {
    el.innerHTML = heading('Desk', 'Press and hold a task to clock in.') + `
      <section class="card">
        <h2>Get set up</h2>
        <ol class="setup">
          <li class="${codebook ? 'done' : ''}"><a href="#settings">Load your code book</a> in Settings${codebook ? ' ✓' : ''}</li>
          <li><a href="#tasks">Add your tasks</a>, named like your portal templates</li>
        </ol>
      </section>
      ${codebook ? totalsCard(entries, running) + actions : ''}`;
    wireExtras(el, codebook);
    tickNow();
    return;
  }

  const sorted = sortTasks(tasks);
  el.innerHTML = heading('Desk', running ? 'Press and hold another task to switch.' : 'Press and hold a task to clock in.')
    + totalsCard(entries, running)
    + `<ul class="desk-list" aria-label="Your tasks">${sorted.map((t) => taskRow(t, codebook, running)).join('')}</ul>`
    + actions;

  el.querySelectorAll('[data-start]').forEach((button) => {
    const task = tasks.find((t) => t.id === button.dataset.start);
    wireHold(button, {
      onHold: () => holdStart(task, tasks, codebook),
      onShortPress: () => {
        if (taskNeedsCode(task, codebook)) holdStart(task, tasks, codebook);
        else if (running && running.taskId === task.id) toast(`Already on the clock for ${task.name}.`);
        else toast('Press and hold to clock in.');
      },
    });
  });
  el.querySelectorAll('[data-more]').forEach((button) => button.addEventListener('click', () => {
    const task = tasks.find((t) => t.id === button.dataset.more);
    openStartSheet(task, codebook, tasks);
  }));
  wireExtras(el, codebook);
  tickNow();
}

function wireExtras(el, codebook) {
  const custom = el.querySelector('[data-custom]');
  if (custom) custom.addEventListener('click', () => openCustomStart(codebook));
  const past = el.querySelector('[data-past]');
  if (past) past.addEventListener('click', () => openEntryForm({}));
}
