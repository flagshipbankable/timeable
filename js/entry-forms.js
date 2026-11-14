// Pop-up forms for time: start options for a task (the ⋯ button), a one-off
// timer, and one shared form for adding past time or editing a session.
// Every save goes through saveTime (adjust.js), which checks for overlaps.

import { icons } from './icons.js';
import { esc, toast } from './ui.js';
import { openSheet } from './sheet.js';
import * as store from './store.js';
import { codeText, findCode } from './codebook.js';
import {
  CUSTOM_CLIENT, clientFieldsHtml, codeOptions, extrasFieldsHtml, extrasFromForm, readClient, wireClientFields,
} from './fields.js';
import { CUSTOM_NAME, customEntry, entryFromTask, readExtras } from './entries.js';
import {
  addDays, entryMs, formatDay, formatHM, formatTime, isValidWorkDate, localDate, parseDateTimeInput,
  rangeProblem, timeInputValue,
} from './time.js';
import { MINUTE, floorMinute, planDelete } from './timeline.js';
import { adjustedSummary, previewText, saveTime } from './adjust.js';
import { openTaskForm, sortTasks } from './views/tasks.js';

const CUSTOM_TASK = '__custom__';

const undoAction = (result) => ({
  action: 'Undo',
  onAction: () => store.undoChanges(result.undo).then(() => toast('Undone.')).catch((error) => toast(error.message)),
});

// Clocks in. Ending the running timer at the new start happens on its own;
// anything more asks first. Starting has no Undo (press-and-hold prevents
// mis-taps), but a start that adjusted other time can be undone.
export async function startSession(entry) {
  const saved = await saveTime(entry);
  if (!saved) return null;
  store.requestPersistence();
  const { plan, asked } = saved;
  const ended = plan.effects.find((e) => e.type === 'end');
  const replaced = plan.effects.find((e) => e.type === 'remove' && e.from.e === null);
  let message = `On the clock: ${entry.taskName}`;
  if (ended) message += ` · ${ended.entry.taskName} ended ${formatTime(ended.to.e)}`;
  else if (replaced && !asked) message += ` · ${replaced.entry.taskName} was under a minute, so it wasn’t kept`;
  if (asked) toast(`${message}.${adjustedSummary(plan)}`, undoAction(saved.result));
  else toast(message);
  return saved;
}

function formError(sheet) {
  const el = sheet.querySelector('.form-error');
  return {
    show(message, field) { el.textContent = message; el.hidden = false; if (field) field.focus(); },
    clear() { el.hidden = true; },
  };
}

function showPreview(el, preview) {
  el.hidden = !preview;
  el.className = `conflict-hint${preview && preview.tone === 'warn' ? ' is-warn' : ''}`;
  el.innerHTML = preview ? `${preview.tone === 'warn' ? icons.warn(18) : icons.desk(18)}<span>${esc(preview.text)}</span>` : '';
}

// Quick times: "Now", "5 min ago", ... They fill a time box.
const CHIPS = [[0, 'Now'], [5, '5 min ago'], [10, '10 min ago'], [15, '15 min ago']];
const chipsHtml = (label, pressed = 0) => `<div class="chips" role="group" aria-label="${esc(label)}">${CHIPS.map(([m, text]) =>
  `<button class="chip-button" type="button" data-ago="${m}" aria-pressed="${m === pressed}">${text}</button>`).join('')}</div>`;

function wireChips(group, input, onPick) {
  group.querySelectorAll('[data-ago]').forEach((button) => button.addEventListener('click', () => {
    const minutes = Number(button.dataset.ago);
    input.value = timeInputValue(new Date(floorMinute(Date.now()) - minutes * MINUTE));
    group.querySelectorAll('[data-ago]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    onPick(minutes);
  }));
  input.addEventListener('input', () => group.querySelectorAll('[data-ago]').forEach((b) => b.setAttribute('aria-pressed', 'false')));
}

// "Start at" is a time today. While "Now" is picked, it follows the clock,
// so a form left open for a few minutes still starts at the real time.
function readStart(input, followNow) {
  if (followNow) return { start: new Date(floorMinute(Date.now())) };
  const start = parseDateTimeInput(`${localDate()}T${input.value}`);
  if (!start) return { error: 'Pick a start time.' };
  if (start.getTime() > Date.now()) return { error: 'That time is later than now. For time before midnight, use Add past time.' };
  return { start };
}

const notesField = (value = '') => `<label>Notes<span class="hint">Optional. Added to the day's activity summary.</span>
  <textarea name="notes" rows="2" maxlength="1000">${esc(value)}</textarea></label>`;

// The start-time part of the start forms: time box, quick chips, preview.
const startFieldsHtml = () => `<div class="start-at">
    <label>Start at<input name="startAt" type="time" value="${timeInputValue(new Date())}" required></label>
    ${chipsHtml('Quick start times')}
    <p class="conflict-hint" aria-live="polite" hidden></p>
  </div>`;

function wireStart(sheet, form, entries, buildEntry) {
  let followNow = true;
  const hint = sheet.querySelector('.start-at .conflict-hint');
  const refresh = () => {
    const { start } = readStart(form.startAt, followNow);
    showPreview(hint, start ? previewText(buildEntry(start), entries, Date.now(), 'start') : null);
  };
  wireChips(sheet.querySelector('.start-at .chips'), form.startAt, (minutes) => { followNow = minutes === 0; refresh(); });
  form.startAt.addEventListener('input', () => { followNow = false; refresh(); });
  refresh();
  return { read: () => readStart(form.startAt, followNow) };
}

// ---- The ⋯ button on a Desk row

export async function openStartSheet(task, codebook, tasks) {
  const entries = await store.listEntries();
  const code = findCode(codebook, task.code);
  openSheet({
    title: task.name,
    bodyHtml: `<p class="muted sheet-sub">${esc(code ? codeText(code) : task.code)}${task.client ? ` · ${esc(task.client)}` : ''}</p>
      <form class="form" id="start-form" novalidate>
        ${startFieldsHtml()}
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
      const start = wireStart(sheet, form, entries, (s) => entryFromTask(task, codebook, { start: s }));
      sheet.querySelector('[data-close]').addEventListener('click', close);
      sheet.querySelector('[data-past]').addEventListener('click', () => { close(); openEntryForm({ taskId: task.id }); });
      sheet.querySelector('[data-edit-task]').addEventListener('click', () => { close(); openTaskForm(task, codebook, tasks); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.clear();
        const { start: s, error: startError } = start.read();
        if (startError) return error.show(startError, form.startAt);
        const client = readClient(form);
        if (client === null) return error.show('Type the client’s name, or pick another option.', form.customClient);
        try {
          const saved = await startSession(entryFromTask(task, codebook, { start: s, client, notes: form.notes.value.trim() }));
          if (saved) close();
        } catch (err) {
          error.show(err.message, form.startAt);
        }
      });
    },
  });
}

// ---- A one-off timer that isn't tied to a task

export async function openCustomStart(codebook) {
  const entries = await store.listEntries();
  openSheet({
    title: 'Clock in on something else',
    bodyHtml: `<form class="form" id="custom-form" novalidate>
        <label>What are you working on?<span class="hint">Leave blank to call it “${CUSTOM_NAME}”.</span>
          <input name="customName" type="text" maxlength="80" autocomplete="off" autofocus></label>
        <label>Service code<span class="hint">Optional now. You can add it later.</span>
          <select name="code">${codeOptions(codebook, '', { optional: true })}</select></label>
        ${clientFieldsHtml(codebook, '', { blankLabel: 'None yet' })}
        ${notesField()}
        ${startFieldsHtml()}
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
      const build = (s) => customEntry(codebook, { name: form.customName.value, code: form.code.value, start: s });
      const start = wireStart(sheet, form, entries, build);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        error.clear();
        const { start: s, error: startError } = start.read();
        if (startError) return error.show(startError, form.startAt);
        const client = readClient(form);
        if (client === null) return error.show('Type the client’s name, or pick another option.', form.customClient);
        const entry = customEntry(codebook, {
          name: form.customName.value, code: form.code.value, client, notes: form.notes.value.trim(), start: s,
        });
        try {
          const saved = await startSession(entry);
          if (saved) close();
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
// saved times, so editing only the notes never shifts a session.
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
      if (end && end.getTime() <= start.getTime()) end = parseDateTimeInput(`${addDays(date, 1)}T${endTime}`);
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
        ${isRunning ? `<div class="end-chips"><p class="chips-label">Finish at</p>${chipsHtml('Quick finish times', -1)}</div>` : ''}
        <p class="time-hint muted small" aria-live="polite"></p>
        <p class="conflict-hint" aria-live="polite" hidden></p>
        ${notesField(e.notes)}
        ${extrasFieldsHtml(e)}
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
      const conflict = sheet.querySelector('#entry-form > .conflict-hint');
      wireClientFields(form);
      sheet.querySelector('[data-close]').addEventListener('click', close);

      // The session as the form describes it right now, for the preview.
      const candidate = () => {
        const times = readTimes(form, init, entry);
        if (times.error || (!times.end && !isRunning)) return null;
        const t = tasks.find((x) => x.id === form.task.value);
        const name = form.task.value === CUSTOM_TASK ? (form.customName.value.trim() || CUSTOM_NAME)
          : t ? t.name : entry ? entry.taskName : 'This session';
        return {
          ...(entry || {}), taskName: name, workDate: times.workDate,
          start: times.start.toISOString(), end: times.end ? times.end.toISOString() : null,
        };
      };

      const refresh = () => {
        const times = readTimes(form, init, entry);
        if (!form.endTime.value) {
          hint.textContent = isRunning ? 'Leave End blank while it’s still running, or fill it in to finish at that time.' : '';
        } else if (times.error || !times.end) {
          hint.textContent = '';
        } else {
          hint.textContent = `${formatHM(times.end - times.start)}${times.overnight ? ' · ends the next day' : ''}`;
        }
        const c = candidate();
        showPreview(conflict, c ? previewText(c, allEntries, Date.now()) : null);
      };

      form.task.addEventListener('change', () => {
        const custom = form.task.value === CUSTOM_TASK;
        form.querySelector('.custom-name').hidden = !custom;
        const t = tasks.find((x) => x.id === form.task.value);
        if (t) { form.code.value = t.code; setClient(form, codebook, t.client); }
        if (custom) form.customName.focus();
        refresh();
      });
      ['workDate', 'startTime', 'endTime'].forEach((name) => {
        form[name].addEventListener('input', refresh);
        form[name].addEventListener('change', refresh);
      });
      const endChips = sheet.querySelector('.end-chips .chips');
      if (endChips) wireChips(endChips, form.endTime, refresh);
      refresh();

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

        try {
          const saved = await saveTime(record);
          if (!saved) return; // went back to change the times
          store.requestPersistence();
          close();
          const summary = adjustedSummary(saved.plan);
          const mine = saved.result.written.filter((w) => saved.plan.proposedIds.includes(w.id) && !w.deleted);
          const total = mine.reduce((sum, w) => sum + entryMs(w, Date.now()), 0);
          let message;
          if (isNew) message = `Added ${formatHM(total)} on ${formatDay(record.workDate)}.`;
          else if (isRunning && record.end) message = `Finished ${record.taskName}.`;
          else message = 'Session saved.';
          toast(`${message}${summary}`, undoAction(saved.result));
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
          try {
            const fresh = await store.getEntry(entry.id);
            const result = await store.applyChanges(planDelete(fresh).changes);
            close();
            toast('Session deleted.', undoAction(result));
          } catch (err) {
            error.show(err.message);
          }
        });
      }
    },
  });
}
