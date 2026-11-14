// Time helpers. Every date here is the device's local date, never UTC, so
// "today" stays right in the evening. (The old version worked out "today" in
// UTC and showed wrong totals after 7 PM Eastern.)

const pad = (n) => String(n).padStart(2, '0');

// "2026-11-14" for the local calendar day of a Date.
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// A Date at local noon on a "YYYY-MM-DD" day (noon avoids daylight-saving edges).
export function dateAtNoon(workDate) {
  const [y, m, d] = workDate.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(workDate, days) {
  const date = dateAtNoon(workDate);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

// Monday of the week that contains workDate.
export function weekStart(workDate) {
  const day = dateAtNoon(workDate).getDay(); // 0 = Sunday
  return addDays(workDate, -((day + 6) % 7));
}

export function isValidWorkDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return localDate(dateAtNoon(value)) === value;
}

// "HH:MM" for a time input, from a Date.
export function timeInputValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// "YYYY-MM-DDTHH:MM" for a datetime-local input, from an ISO time.
export function dateTimeInputValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localDate(d)}T${timeInputValue(d)}`;
}

// Reads a datetime-local value as local time. Returns null for impossible
// times (such as the hour skipped when clocks spring forward) instead of
// letting the browser quietly move the entry to a different time.
export function parseDateTimeInput(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const date = new Date(y, m - 1, d, hh, mm, 0, 0);
  return dateTimeInputValue(date.toISOString()) === value ? date : null;
}

// Builds start and end from a work date plus two "HH:MM" times. An end time
// at or before the start means the session ran past midnight.
export function rangeFromDayAndTimes(workDate, startTime, endTime) {
  const start = parseDateTimeInput(`${workDate}T${startTime}`);
  if (!start) return { error: 'Pick a start time.' };
  let end = parseDateTimeInput(`${workDate}T${endTime}`);
  if (!end) return { error: 'Pick an end time.' };
  let overnight = false;
  if (end.getTime() <= start.getTime()) {
    end = parseDateTimeInput(`${addDays(workDate, 1)}T${endTime}`);
    if (!end) return { error: 'Pick an end time.' };
    overnight = true;
  }
  return { start, end, overnight };
}

// Plain-language problem with a time range, or null if it's fine.
// A one-minute allowance covers small clock differences.
export function rangeProblem(start, end, nowMs, { allowOpen = false } = {}) {
  const grace = 60 * 1000;
  if (!start) return 'Pick a start time.';
  if (start.getTime() > nowMs + grace) return 'The start can’t be in the future.';
  if (!end) return allowOpen ? null : 'Pick an end time.';
  if (end.getTime() > nowMs + grace) return 'The end can’t be in the future.';
  if (end.getTime() < start.getTime()) return 'The end has to be after the start. For a session past midnight, set the end on the next day.';
  if (end.getTime() - start.getTime() > 24 * 3600 * 1000) return 'That’s more than 24 hours. Check the dates.';
  return null;
}

// Milliseconds in an entry; a running entry counts up to now.
export function entryMs(entry, nowMs) {
  const start = Date.parse(entry.start);
  const end = entry.end ? Date.parse(entry.end) : nowMs;
  return Math.max(0, end - start);
}

// "2:05:09" for a live timer.
export function formatClock(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${pad(m)}:${pad(s)}`;
}

// "2h 05m" for a total (whole minutes, rounded down).
export function formatHM(ms) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

// "2.08" exact decimal hours, for comparison with portal hours.
export function decimalHours(ms) {
  return (ms / 3600000).toFixed(2);
}

// "9:05 AM"
export function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// "Fri, Nov 13"
export function formatDay(workDate) {
  return dateAtNoon(workDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Friday, November 13"
export function formatDayLong(workDate) {
  return dateAtNoon(workDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Reads an optional number field. Empty means 0. Returns NaN for bad input.
export function readAmount(value) {
  const text = String(value ?? '').trim().replace(/^\$/, '');
  if (text === '') return 0;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return NaN;
  return Number(text);
}
