// Day: every session on one work date, to the exact minute. Portal lines
// (rounded hours, copy buttons, entered checkmarks) build on this in Phase 4.

import { icons } from '../icons.js';
import { esc, heading } from '../ui.js';
import * as store from '../store.js';
import {
  addDays, decimalHours, entryMs, formatClock, formatDayLong, formatHM, formatTime, isValidWorkDate, localDate,
} from '../time.js';
import { openEntryForm } from '../entry-forms.js';
import { overlappingIds } from '../timeline.js';
import { tickNow } from '../running.js';

// The day being looked at. null means "today", so it follows the calendar.
let selected = null;

// 8.6 stays 8.6 and 0.25 stays 0.25 (no padded zeros).
const amount = (n) => String(Math.round(n * 100) / 100);

function extrasText(e) {
  const parts = [];
  if (e.travelHours) parts.push(`Travel ${amount(e.travelHours)} h`);
  if (e.prepHours) parts.push(`Prep ${amount(e.prepHours)} h`);
  if (e.miles) parts.push(`${amount(e.miles)} mi`);
  if (e.destination) parts.push(e.destination);
  if (e.expenses) parts.push(`$${e.expenses.toFixed(2)}`);
  return parts.join(' · ');
}

function sessionRow(e, nowMs, overlaps) {
  const running = !e.end;
  const nextDay = e.end && localDate(new Date(e.end)) !== e.workDate;
  const code = e.code ? `${e.code} ${e.codeLabel}`.trim() : 'No code yet';
  const meta = [code, e.client].filter(Boolean).join(' · ');
  const extras = extrasText(e);
  const clash = overlaps.has(e.id);
  return `<li><button class="session${clash ? ' has-overlap' : ''}" type="button" data-entry="${esc(e.id)}">
      <span class="session-time">${esc(formatTime(e.start))} – ${running ? 'now' : esc(formatTime(e.end))}${nextDay ? ' <span class="tag">next day</span>' : ''}</span>
      <span class="session-main">
        <span class="session-name">${esc(e.taskName)}${clash ? ` <span class="tag tag-warn">${icons.warn(12)} Overlaps</span>` : ''}</span>
        <span class="session-meta${e.code ? '' : ' is-missing'}">${esc(meta)}</span>
        ${e.notes ? `<span class="session-notes">${esc(e.notes)}</span>` : ''}
        ${extras ? `<span class="session-extras">${esc(extras)}</span>` : ''}
      </span>
      <span class="session-length">${running
        ? `<span class="pulse" aria-hidden="true"></span><span data-live="clock">${formatClock(entryMs(e, nowMs))}</span>`
        : esc(formatHM(entryMs(e, nowMs)))}</span>
    </button></li>`;
}

export async function render(el) {
  const today = localDate();
  const day = selected && isValidWorkDate(selected) && selected <= today ? selected : today;
  // Oldest first, so the day reads like a timeline.
  const entries = (await store.listEntriesForDate(day)).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const nowMs = Date.now();
  const running = entries.find((e) => !e.end);
  const totalMs = entries.reduce((sum, e) => sum + entryMs(e, nowMs), 0);
  const base = totalMs - (running ? entryMs(running, nowMs) : 0);
  const isToday = day === today;
  // Sessions saved before the overlap rules (or from an imported backup)
  // could overlap. Point them out so they can be fixed.
  const overlaps = overlappingIds(entries, nowMs);

  el.innerHTML = heading('Day', formatDayLong(day)) + `
    <div class="day-nav">
      <button class="icon-button" type="button" data-go="-1" aria-label="Previous day">${icons.back(22)}</button>
      <input class="day-pick" type="date" value="${day}" max="${today}" aria-label="Pick a day">
      <button class="icon-button" type="button" data-go="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>${icons.chevron(22)}</button>
      ${isToday ? '' : '<button class="button button-soft button-small" type="button" data-today>Today</button>'}
    </div>
    <section class="card day-total">
      <div>
        <p class="total-label">Logged ${isToday ? 'today' : 'this day'}</p>
        <p class="total-value" data-live="hm" data-base="${base}" data-running="${running ? 'yes' : 'no'}">${formatHM(totalMs)}</p>
      </div>
      <p class="muted small">${entries.length} session${entries.length === 1 ? '' : 's'}${entries.length ? ` · ${decimalHours(totalMs)} hours exact` : ''}</p>
    </section>
    ${overlaps.size ? `<div class="notice notice-warn">${icons.warn(20)}<p>Some sessions overlap, so those minutes count twice. Tap one and save it to choose how to fix it.</p></div>` : ''}
    ${entries.length ? `<ul class="session-list" aria-label="Sessions">${entries.map((e) => sessionRow(e, nowMs, overlaps)).join('')}</ul>`
      : `<section class="card empty"><span class="empty-icon">${icons.day(26)}</span><h2>No time logged</h2><p>${isToday ? 'Clock in from the Desk, or add time you forgot.' : 'Nothing was logged on this day.'}</p></section>`}
    <div class="desk-actions">
      <button class="button button-soft" type="button" data-past>${icons.clockPlus(18)} Add past time${isToday ? '' : ' to this day'}</button>
    </div>
    <p class="muted small">Portal lines, rounded to the quarter hour with copy buttons, arrive in the next update.</p>`;

  el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const next = addDays(day, Number(b.dataset.go));
    selected = next >= today ? null : next;
    render(el);
  }));
  const todayButton = el.querySelector('[data-today]');
  if (todayButton) todayButton.addEventListener('click', () => { selected = null; render(el); });
  el.querySelector('.day-pick').addEventListener('change', (e) => {
    const value = e.target.value;
    if (!isValidWorkDate(value)) return;
    selected = value >= today ? null : value;
    render(el);
  });
  el.querySelectorAll('[data-entry]').forEach((b) => b.addEventListener('click', () => {
    const entry = entries.find((x) => x.id === b.dataset.entry);
    openEntryForm({ entry });
  }));
  el.querySelector('[data-past]').addEventListener('click', () => openEntryForm({ workDate: day }));
  tickNow();
}
