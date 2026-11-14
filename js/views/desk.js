// Desk: today's totals and the task list. One tap on a task clocks in.

import { icons } from '../icons.js';
import { esc, heading, prefs, toast } from '../ui.js';
import * as store from '../store.js';
import { findCode, taskNeedsCode } from '../codebook.js';
import { entryFromTask, totals } from '../entries.js';
import { entryMs, formatClock, formatHM, localDate } from '../time.js';
import { clockInWithUndo, openCustomStart, openEntryForm, openStartSheet } from '../entry-forms.js';
import { tickNow } from '../running.js';
import { openTaskForm, sortTasks } from './tasks.js';

export const weeklyTargetHours = () => Number(prefs.get('weeklyTargetHours', 40)) || 40;

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

function taskRow(task, codebook, running) {
  const needs = taskNeedsCode(task, codebook);
  const isRunning = running && running.taskId === task.id;
  const code = findCode(codebook, task.code);
  const meta = [code ? `${code.code} ${code.label}` : task.code, task.client].filter(Boolean).join(' · ');
  return `<li class="desk-row${isRunning ? ' is-running' : ''}${needs ? ' needs-code' : ''}">
      <button class="desk-main" type="button" data-start="${esc(task.id)}" aria-label="${esc(isRunning ? `${task.name}, on the clock` : `Clock in: ${task.name}`)}">
        <span class="desk-star">${task.favorite ? icons.starFilled(16) : ''}</span>
        <span class="desk-text">
          <span class="desk-name">${esc(task.name)}</span>
          <span class="desk-meta">${esc(meta)}</span>
          ${needs ? `<span class="tag tag-warn">${icons.warn(14)} Needs a new code</span>` : ''}
        </span>
        ${isRunning ? `<span class="desk-live"><span class="pulse" aria-hidden="true"></span><span data-live="clock">${formatClock(entryMs(running, Date.now()))}</span></span>` : ''}
      </button>
      <button class="icon-button desk-more" type="button" data-more="${esc(task.id)}" aria-label="${esc(`More for ${task.name}`)}">${icons.more(22)}</button>
    </li>`;
}

export async function render(el) {
  const [codebook, tasks, entries, running] = await Promise.all([
    store.getCodebook(), store.listTasks(), store.listEntries(), store.getRunningEntry(),
  ]);

  if (!codebook || tasks.length === 0) {
    el.innerHTML = heading('Desk', 'Tap a task to clock in.') + `
      <section class="card">
        <h2>Get set up</h2>
        <ol class="setup">
          <li class="${codebook ? 'done' : ''}"><a href="#settings">Load your code book</a> in Settings${codebook ? ' ✓' : ''}</li>
          <li><a href="#tasks">Add your tasks</a>, named like your portal templates</li>
        </ol>
      </section>
      ${codebook ? `${totalsCard(entries, running)}<div class="desk-actions">
        <button class="button button-soft" type="button" data-custom>${icons.play(18)} Clock in on something else</button>
        <button class="button button-soft" type="button" data-past>${icons.clockPlus(18)} Add past time</button></div>` : ''}`;
    wireExtras(el, codebook);
    tickNow();
    return;
  }

  const sorted = sortTasks(tasks);
  el.innerHTML = heading('Desk', running ? 'Tap another task to switch.' : 'Tap a task to clock in.')
    + totalsCard(entries, running)
    + `<ul class="desk-list" aria-label="Your tasks">${sorted.map((t) => taskRow(t, codebook, running)).join('')}</ul>
      <div class="desk-actions">
        <button class="button button-soft" type="button" data-custom>${icons.play(18)} Clock in on something else</button>
        <button class="button button-soft" type="button" data-past>${icons.clockPlus(18)} Add past time</button>
      </div>`;

  el.querySelectorAll('[data-start]').forEach((button) => button.addEventListener('click', () => quickStart(button, tasks, codebook)));
  el.querySelectorAll('[data-more]').forEach((button) => button.addEventListener('click', () => {
    const task = tasks.find((t) => t.id === button.dataset.more);
    openStartSheet(task, codebook, tasks);
  }));
  wireExtras(el, codebook);
  tickNow();
}

// One tap clocks in. A second tap while the first is still saving is
// ignored, so a quick double tap can't start two sessions.
let starting = false;

async function quickStart(button, tasks, codebook) {
  if (starting) return;
  const task = tasks.find((t) => t.id === button.dataset.start);
  if (taskNeedsCode(task, codebook)) {
    toast(`“${task.name}” needs a new code first.`, { action: 'Fix', onAction: () => openTaskForm(task, codebook, tasks) });
    return;
  }
  starting = true;
  button.disabled = true;
  try {
    const current = await store.getRunningEntry();
    if (current && current.taskId === task.id) {
      toast(`Already on the clock for ${task.name}.`);
      return;
    }
    await clockInWithUndo(entryFromTask(task, codebook, { start: new Date() }));
  } catch (error) {
    toast(error.message);
  } finally {
    starting = false;
    button.disabled = false;
  }
}

function wireExtras(el, codebook) {
  const custom = el.querySelector('[data-custom]');
  if (custom) custom.addEventListener('click', () => openCustomStart(codebook));
  const past = el.querySelector('[data-past]');
  if (past) past.addEventListener('click', () => openEntryForm({}));
}
