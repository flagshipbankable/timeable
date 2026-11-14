// Time entry logic: building entries from tasks, checking edits, and totals.
// No screens or storage here, so it can be tested on its own.

import { findCode } from './codebook.js';
import { entryMs, localDate, readAmount, weekStart } from './time.js';

export const CUSTOM_NAME = 'Custom time';

// Fields every entry has. Optional extras start empty.
function baseEntry() {
  return {
    taskId: null, taskName: CUSTOM_NAME, code: '', codeLabel: '', billable: false,
    client: '', notes: '', travelHours: 0, prepHours: 0, miles: 0, destination: '', expenses: 0,
  };
}

// An entry copies the task's name and code details at the moment it's
// logged, so editing or deleting the task later never changes it.
export function entryFromTask(task, codebook, { start, end = null, notes = '', client } = {}) {
  const code = findCode(codebook, task.code);
  return {
    ...baseEntry(),
    taskId: task.id,
    taskName: task.name,
    code: task.code,
    codeLabel: code ? code.label : '',
    billable: code ? code.billable : false,
    client: client !== undefined ? client : task.client || '',
    notes,
    workDate: localDate(start),
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
  };
}

// A one-off entry. The code is optional so time can be captured fast and
// sorted out later.
export function customEntry(codebook, { name, code = '', client = '', notes = '', start, end = null, workDate }) {
  const c = code ? findCode(codebook, code) : null;
  return {
    ...baseEntry(),
    taskName: (name || '').trim() || CUSTOM_NAME,
    code: c ? c.code : '',
    codeLabel: c ? c.label : '',
    billable: c ? c.billable : false,
    client,
    notes,
    workDate: workDate || localDate(start),
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
  };
}

// Applies a new code choice to an entry, refreshing its copied details.
export function withCode(entry, codebook, code) {
  if (code === entry.code) return entry;
  const c = code ? findCode(codebook, code) : null;
  return { ...entry, code: c ? c.code : '', codeLabel: c ? c.label : '', billable: c ? c.billable : false };
}

// Checks the optional extras typed into an entry form. Returns
// { values, errors } with numbers already parsed.
export function readExtras(form) {
  const errors = [];
  const values = {};
  const fields = [
    ['travelHours', 'Travel hours', 24],
    ['prepHours', 'Prep hours', 24],
    ['miles', 'Miles', 10000],
    ['expenses', 'Expenses', 100000],
  ];
  for (const [key, label, max] of fields) {
    const n = readAmount(form[key]);
    if (Number.isNaN(n) || n < 0) errors.push(`${label} must be a number, like 0.25.`);
    else if (n > max) errors.push(`${label} looks too large.`);
    else values[key] = Math.round(n * 100) / 100;
  }
  values.destination = String(form.destination ?? '').trim();
  return { values, errors };
}

export function runningEntry(entries) {
  return entries.find((e) => !e.deleted && !e.end) || null;
}

// Exact (unrounded) totals for the Desk. Days follow each entry's work date.
export function totals(entries, nowMs, today = localDate(new Date(nowMs))) {
  const monday = weekStart(today);
  let todayMs = 0;
  let weekMs = 0;
  let todayCount = 0;
  for (const e of entries) {
    if (e.deleted) continue;
    const ms = entryMs(e, nowMs);
    if (e.workDate === today) { todayMs += ms; todayCount += 1; }
    if (e.workDate >= monday && e.workDate <= today) weekMs += ms;
  }
  return { todayMs, weekMs, todayCount, monday };
}

// Newest first, for lists.
export function newestFirst(a, b) {
  return Date.parse(b.start) - Date.parse(a.start);
}

// Other sessions whose time overlaps this one (a running session counts up
// to now). Used to warn before saving, since overlaps would count time twice.
export function findOverlaps(entry, entries, nowMs) {
  const start = Date.parse(entry.start);
  const end = entry.end ? Date.parse(entry.end) : nowMs;
  return entries.filter((e) => !e.deleted && e.id !== entry.id
    && Date.parse(e.start) < end && (e.end ? Date.parse(e.end) : nowMs) > start);
}
