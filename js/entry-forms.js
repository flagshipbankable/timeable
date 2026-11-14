// Pop-up forms for time: start options for a task (the ⋯ button), a one-off
// timer, and one shared form for adding past time or editing a session.

import { icons } from './icons.js';
import { esc, toast } from './ui.js';
import { openSheet } from './sheet.js';
import * as store from './store.js';
import { codeText, findCode } from './codebook.js';
import {
  CUSTOM_CLIENT, clientFieldsHtml, codeOptions, extrasFieldsHtml, extrasFromForm, readClient, wireClientFields,
} from './fields.js';
import { CUSTOM_NAME, customEntry, entryFromTask, findOverlaps, readExtras } from './entries.js';
import {
  addDays, entryMs, formatDay, formatHM, formatTime, isValidWorkDate, localDate, parseDateTimeInput,
  rangeProblem, timeInputValue,
} from './time.js';
import { openTaskForm, sortTasks } from './views/tasks.js';

const CUSTOM_TASK = '__custom__';

// Clocks in and offers Undo. Throws with a plain message if it can't.
export async function clockInWithUndo(entry) {
  const token = await store.clockIn(entry);
  store.requestPersistence();
  const switched = token.endedIds.length > 0;
  toast(`${switched ? 'Switched to' : 'On the clock:'} ${entry.taskName}`, {
    action: 'Undo',
    onAction: () => store.undoClockIn(token).catch((error) => toast(error.message)),
  });
  return token;
}

function formError(sheet) {
  const el = sheet.querySelector('.form-error');
  return {
    show(message, field) { el.textContent = message; el.hidden = false; if (field) field.focus(); },
    clear() { el.hidden = true; },
  };
}

// "Start at" is a time today. If it's left at the time the form opened,
// the session starts right now, to the second.
function readStartAt(input, openedValue) {
  if (input.value === openedValue) return { start: new Date() };
  const start = parseDateTimeInput(`${localDate()}T${input.value}`);
  if (!start) return { error: 'Pick a start time.' };
  if (start.getTime() > Date.now() + 60000) return { error: 'That time is later than now. For time before midnight, use Add past time.' };
  return { start };
}

const notesField = (value = '') => `<label>Notes<span class="hint">Optional. Added to the day's activity summary.</span>
  <textarea name="notes" rows="2" maxlength="1000">${esc(value)}</textarea></label>`;

// ---- The ⋯ button on a Desk row

export function openStartSheet(task, codebook, tasks) {
  const opened = timeInputValue(new Date());
  const code = findCode(codebook, task.code);
  openSheet({
    title: task.name,
    bodyHtml: `<p class="muted sheet-sub">${esc(code ? codeText(code) : task.code)}${task.client ? ` · ${esc(task.client)}` : ''}</p>
      <form class="form" id="start-form" novalidate>
        <label>Start at<span class="hint">Change it if you started earlier today.</span>
          <input name="startAt" type="time" value="${opened}" required></label>
        ${clientFieldsHtml(codebook, task.client, { label: 'Client for this session', blankLabel: 'None' })}
        ${notesField()}
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">${icons.play(18)} Start</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
        <div class="sheet-links">
          <button class="link-button" type="button" data-past>Add past time for this task</button>
          <button class="link-button" type="button" data-edit-task>Edit task</button>
        </div>
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('#start-form');
      const error = formError(sheet);
      wireClientFields(form);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      sheet.querySelector('[data-past]').addEventListener('click', () => { close(); openEntryForm({ taskId: task.id }); });
      sheet.querySelector('[data-edit-task]').addEventListener('click', () => { close(); openTaskForm(task, codebook, tasks); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.clear();
        const { start, error: startError } = readStartAt(form.startAt, opened);
        if (startError) return error.show(startError, form.startAt);
        const client = readClient(form);
        if (client === null) return error.show('Type the client’s name, or pick another option.', form.customClient);
        try {
          await clockInWithUndo(entryFromTask(task, codebook, { start, client, notes: form.notes.value.trim() }));
          close();
        } catch (err) {
          error.show(err.message, form.startAt);
        }
      });
    },
  });
}

// ---- A one-off timer that isn't tied to a task

export function openCustomStart(codebook) {
  const opened = timeInputValue(new Date());
  openSheet({
    title: 'Clock in on something else',
    bodyHtml: `<form class="form" id="custom-form" novalidate>
        <label>What are you working on?<span class="hint">Leave blank to call it “${CUSTOM_NAME}”.</span>
          <input name="customName" type="text" maxlength="80" autocomplete="off" autofocus></label>
        <label>Service code<span class="hint">Optional now. You can add it later.</span>
          <select name="code">${codeOptions(codebook, '', { optional: true })}</select></label>
        ${clientFieldsHtml(codebook, '', { blankLabel: 'None yet' })}
        ${notesField()}
        <label>Start at<input name="startAt" type="time" value="${opened}" required></label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">${icons.play(18)} Start</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('#custom-form');
      const error = formError(sheet);
      wireClientFields(form);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.clear();
        const { start, error: startError } = readStartAt(form.startAt, opened);
        if (startError) return error.show(startError, form.startAt);
        const client = readClient(form);
        if (client === null) return error.show('Type the client’s name, or pick another option.', form.customClient);
        const entry = customEntry(codebook, {
          name: form.customName.value, code: form.code.value, client, notes: form.notes.value.trim(), start,
        });
        try {
          await clockInWithUndo(entry);
          close();
        } catch (err) {
          error.show(err.message, form.startAt);
        }
      });
    },
  });
}

// ---- Add past time, or edit a session

function taskOptions(tasks, selectedId, entry) {
  const missing = entry && entry.taskId && !tasks.some((t) => t.id === entry.taskId)
    ? `<option value="${esc(entry.taskId)}" selected>${esc(entry.taskName)} (deleted task)</option>` : '';
  return `${selectedId ? '' : '<option value="" selected disabled>Choose a task</option>'}${missing}
    ${sortTasks(tasks).map((t) => `<option value="${esc(t.id)}" ${t.id === selectedId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    <option value="${CUSTOM_TASK}" ${selectedId === CUSTOM_TASK ? 'selected' : ''}>Custom time (not a task)</option>`;
}

function setClient(form, codebook, client) {
  const box = form.querySelector('.custom-client');
  if (!client) form.client.value = '';
  else if (codebook.clients.includes(client)) form.client.value = client;
  else { form.client.value = CUSTOM_CLIENT; form.customClient.value = client; }
  box.hidden = form.client.value !== CUSTOM_CLIENT;
}

// Builds start and end from the form. Fields left as they were keep their
// exact saved times, so editing only the notes never shifts a session.
function readTimes(form, init, entry) {
  const date = form.workDate.value;
  const startTime = form.startTime.value;
  const endTime = form.endTime.value;
  if (!isValidWorkDate(date)) return { error: 'Pick a date.', field: form.workDate };
  if (!startTime) return { error: 'Pick a start time.', field: form.startTime };
  if (endTime && endTime === startTime) return { error: 'The start and end are the same time.', field: form.endTime };
  const startChanged = !entry || date !== init.date || startTime !== init.start;
  const endChanged = !entry || endTime !== init.end;
  const start = startChanged ? parseDateTimeInput(`${date}T${startTime}`) : new Date(entry.start);
  if (!start) return { error: 'That start time doesn’t exist (clocks changed that night). Pick another.', field: form.startTime };
  let end = null;
  let overnight = false;
  if (endTime) {
    if (!startChanged && !endChanged && entry.end) end = new Date(entry.end);
    else {
      end = parseDateTimeInput(`${date}T${endTime}`);
      if (end && end.getTime() <= start.getTime()) { end = parseDateTimeInput(`${addDays(date, 1)}T${endTime}`); overnight = true; }
      if (!end) return { error: 'That end time doesn’t exist (clocks changed that night). Pick another.', field: form.endTime };
    }
    overnight = localDate(end) !== localDate(start);
  }
  return { start, end, overnight, workDate: startChanged ? date : entry.workDate };
}

export async function openEntryForm({ entry = null, workDate, taskId } = {}) {
  const [codebook, tasks, allEntries] = await Promise.all([store.getCodebook(), store.listTasks(), store.listEntries()]);
  if (!codebook) { toast('Load your code book in Settings first.'); return; }
  const isNew = !entry;
  const isRunning = Boolean(entry && !entry.end);
  const selectedTask = isNew ? (taskId || '') : (entry.taskId || CUSTOM_TASK);
  const prefillTask = isNew && taskId ? tasks.find((t) => t.id === taskId) : null;
  const init = {
    date: isNew ? (workDate || localDate()) : entry.workDate,
    start: isNew ? '' : timeInputValue(new Date(entry.start)),
    end: isNew || !entry.end ? '' : timeInputValue(new Date(entry.end)),
  };
  const e = entry || { code: prefillTask ? prefillTask.code : '', client: prefillTask ? prefillTask.client : '', notes: '' };
  const title = isNew ? 'Add past time' : isRunning ? 'Edit current session' : 'Edit session';

  openSheet({
    title,
    bodyHtml: `<form class="form" id="entry-form" novalidate>
        <label>Task<select name="task">${taskOptions(tasks, selectedTask, entry)}</select></label>
        <label class="custom-name" ${selectedTask === CUSTOM_TASK ? '' : 'hidden'}>Name
          <input name="customName" type="text" maxlength="80" autocomplete="off" value="${esc(selectedTask === CUSTOM_TASK && entry ? entry.taskName : '')}" placeholder="${CUSTOM_NAME}"></label>
        <label>Service code<select name="code">${codeOptions(codebook, e.code, { optional: selectedTask === CUSTOM_TASK })}</select></label>
        ${clientFieldsHtml(codebook, e.client, { blankLabel: 'None' })}
        <label>Date<input name="workDate" type="date" value="${esc(init.date)}" max="${localDate()}" required></label>
        <div class="form-two">
          <label>Start<input name="startTime" type="time" value="${esc(init.start)}" required></label>
          <label>End<input name="endTime" type="time" value="${esc(init.end)}"></label>
        </div>
        <p class="time-hint muted small" aria-live="polite"></p>
        ${notesField(e.notes)}
        ${extrasFieldsHtml(e)}
        <div class="notice notice-warn overlap" hidden>${icons.warn(20)}<p></p></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">${isNew ? 'Add' : 'Save'}</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
        ${isNew ? '' : `<div class="danger-zone">
          <button class="button button-ghost-danger" type="button" data-delete>Delete session</button>
          <div class="confirm-delete" hidden><p>Delete this session${isRunning ? ' and stop the timer' : ''}?</p>
            <div class="button-row"><button class="button button-danger" type="button" data-confirm-delete>Delete</button>
            <button class="button button-soft" type="button" data-keep>Keep</button></div></div>
        </div>`}
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('#entry-form');
      const error = formError(sheet);
      const hint = sheet.querySelector('.time-hint');
      const overlapBox = sheet.querySelector('.overlap');
      const submit = form.querySelector('[type="submit"]');
      let overlapOk = false;
      wireClientFields(form);
      sheet.querySelector('[data-close]').addEventListener('click', close);

      form.task.addEventListener('change', () => {
        const custom = form.task.value === CUSTOM_TASK;
        form.querySelector('.custom-name').hidden = !custom;
        const t = tasks.find((x) => x.id === form.task.value);
        if (t) { form.code.value = t.code; setClient(form, codebook, t.client); }
        if (custom) form.customName.focus();
      });

      const showHint = () => {
        if (!form.endTime.value) {
          hint.textContent = isRunning ? 'Leave End blank while it’s still running, or fill it in to finish at that time.' : '';
          return;
        }
        const times = readTimes(form, init, entry);
        if (times.error || !times.end) { hint.textContent = ''; return; }
        hint.textContent = `${formatHM(times.end - times.start)}${times.overnight ? ' · ends the next day' : ''}`;
      };
      const timesChanged = () => { overlapOk = false; overlapBox.hidden = true; submit.textContent = isNew ? 'Add' : 'Save'; showHint(); };
      ['workDate', 'startTime', 'endTime'].forEach((name) => {
        form[name].addEventListener('input', timesChanged);
        form[name].addEventListener('change', timesChanged);
      });
      showHint();

      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        error.clear();
        const chosen = form.task.value;
        if (!chosen) return error.show('Choose a task, or Custom time.', form.task);
        const isCustom = chosen === CUSTOM_TASK;
        const task = tasks.find((t) => t.id === chosen);

        const code = form.code.value;
        if (!code && !isCustom) return error.show('Choose a service code.', form.code);
        const keepsOldCode = !isNew && code === entry.code;
        const c = code ? findCode(codebook, code) : null;
        if (code && !keepsOldCode && (!c || c.active === false)) return error.show('That code is retired. Choose a current one.', form.code);

        const client = readClient(form);
        if (client === null) return error.show('Type the client’s name, or pick another option.', form.customClient);

        const times = readTimes(form, init, entry);
        if (times.error) return error.show(times.error, times.field);
        if (!times.end && !isRunning) return error.show('Pick an end time.', form.endTime);
        const problem = rangeProblem(times.start, times.end, Date.now(), { allowOpen: isRunning });
        if (problem) return error.show(problem, times.end ? form.endTime : form.startTime);

        const extras = readExtras(extrasFromForm(form));
        if (extras.errors.length) return error.show(extras.errors[0]);

        let taskFields;
        if (isCustom) taskFields = { taskId: null, taskName: form.customName.value.trim() || CUSTOM_NAME };
        else if (!isNew && chosen === entry.taskId) taskFields = { taskId: entry.taskId, taskName: entry.taskName };
        else taskFields = { taskId: task.id, taskName: task.name };
        const codeFields = keepsOldCode
          ? { code: entry.code, codeLabel: entry.codeLabel, billable: entry.billable }
          : { code: c ? c.code : '', codeLabel: c ? c.label : '', billable: c ? c.billable : false };

        const record = {
          ...(entry || customEntry(codebook, { start: times.start })),
          ...taskFields,
          ...codeFields,
          client,
          notes: form.notes.value.trim(),
          ...extras.values,
          workDate: times.workDate,
          start: times.start.toISOString(),
          end: times.end ? times.end.toISOString() : null,
        };

        const overlaps = findOverlaps(record, allEntries, Date.now());
        if (overlaps.length && !overlapOk) {
          overlapOk = true;
          const list = overlaps.slice(0, 3).map((o) => `${o.taskName}, ${formatDay(o.workDate)} ${formatTime(o.start)}–${o.end ? formatTime(o.end) : 'now'}`).join('; ');
          overlapBox.querySelector('p').textContent = `This overlaps ${list}. Overlapping time counts twice. Change the times, or tap Save anyway.`;
          overlapBox.hidden = false;
          submit.textContent = 'Save anyway';
          overlapBox.scrollIntoView({ block: 'nearest' });
          return;
        }

        try {
          const saved = await store.saveEntry(record);
          store.requestPersistence();
          close();
          if (isNew) toast(`Added ${formatHM(entryMs(saved, Date.now()))} on ${formatDay(saved.workDate)}.`);
          else toast(isRunning && saved.end ? `Finished ${saved.taskName}.` : 'Session saved.');
        } catch (err) {
          error.show(err.message);
        }
      });

      const del = sheet.querySelector('[data-delete]');
      if (del) {
        const confirmBox = sheet.querySelector('.confirm-delete');
        del.addEventListener('click', () => { confirmBox.hidden = false; del.hidden = true; });
        sheet.querySelector('[data-keep]').addEventListener('click', () => { confirmBox.hidden = true; del.hidden = false; });
        sheet.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
          await store.deleteEntry(entry.id);
          close();
          toast('Session deleted.', {
            action: 'Undo',
            onAction: () => store.restoreEntry(entry.id).catch((err) => toast(err.message)),
          });
        });
      }
    },
  });
}
