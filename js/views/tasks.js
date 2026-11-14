// Tasks: named like the portal's templates, each with a service code,
// default client, and default activity summary.

import { icons } from '../icons.js';
import { emptyState, esc, heading, toast } from '../ui.js';
import { openSheet } from '../sheet.js';
import * as store from '../store.js';
import { codeText, findCode, taskNeedsCode } from '../codebook.js';
import { clientFieldsHtml, codeOptions, readClient, wireClientFields } from '../fields.js';

// Favorites first, then alphabetical (ignoring capitals).
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => Number(b.favorite) - Number(a.favorite)
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export async function render(el) {
  const [codebook, tasks] = await Promise.all([store.getCodebook(), store.listTasks()]);
  if (!codebook) {
    el.innerHTML = heading('Tasks', 'Named to match your portal templates') + emptyState(
      icons.tasks(26), 'Load your code book first',
      'Tasks are built from your service codes. Load the code book file in Settings, then come back here.',
    ) + '<p class="center"><a class="button" href="#settings">Go to Settings</a></p>';
    return;
  }

  const sorted = sortTasks(tasks);
  const flagged = sorted.filter((t) => taskNeedsCode(t, codebook)).length;
  el.innerHTML = `${heading('Tasks', 'Named to match your portal templates')}
    <div class="button-row top-actions"><button class="button" type="button" id="new-task">${icons.plus(18)} New task</button></div>
    ${flagged ? `<div class="notice notice-warn">${icons.warn(20)}<p>${flagged === 1 ? '1 task needs' : `${flagged} tasks need`} a new service code. Tap ${flagged === 1 ? 'it' : 'each one'} to choose one.</p></div>` : ''}
    ${sorted.length ? `<ul class="task-list">${sorted.map((t) => taskRow(t, codebook)).join('')}</ul>`
      : emptyState(icons.tasks(26), 'No tasks yet', 'Add a task for each portal template you use, with the same name, so entering time is a quick match.')}`;

  el.querySelector('#new-task').addEventListener('click', () => openTaskForm(null, codebook, tasks));
  el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    openTaskForm(tasks.find((t) => t.id === b.dataset.edit), codebook, tasks);
  }));
  el.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', async () => {
    const task = tasks.find((t) => t.id === b.dataset.star);
    await store.setTaskFavorite(task.id, !task.favorite);
  }));
}

function taskRow(t, codebook) {
  const code = findCode(codebook, t.code);
  const needs = taskNeedsCode(t, codebook);
  return `<li class="task-row ${needs ? 'needs-code' : ''}">
    <button class="icon-button star ${t.favorite ? 'is-on' : ''}" type="button" data-star="${esc(t.id)}"
      aria-pressed="${t.favorite}" aria-label="${t.favorite ? 'Remove from favorites' : 'Add to favorites'}: ${esc(t.name)}">
      ${t.favorite ? icons.starFilled(20) : icons.star(20)}</button>
    <button class="task-main" type="button" data-edit="${esc(t.id)}">
      <strong>${esc(t.name)}</strong>
      <span class="task-meta">${esc(code ? codeText(code) : t.code)}${t.client ? ` · ${esc(t.client)}` : ''}</span>
      ${needs ? `<span class="tag tag-warn">${icons.warn(14)} Needs a new code</span>` : ''}
    </button>
  </li>`;
}

export function openTaskForm(task, codebook, allTasks) {
  const isNew = !task;
  const t = task || { name: '', code: '', client: '', summary: '', favorite: false };
  const needs = !isNew && taskNeedsCode(t, codebook);

  openSheet({
    title: isNew ? 'New task' : 'Edit task',
    bodyHtml: `<form class="form" id="task-form" novalidate>
        ${needs ? `<div class="notice notice-warn">${icons.warn(20)}<p>This task's code is retired. Choose a new one.</p></div>` : ''}
        <label>Name<span class="hint">Same as the portal template</span>
          <input name="name" type="text" maxlength="80" required value="${esc(t.name)}" ${isNew ? 'autofocus' : ''} autocomplete="off"></label>
        <label>Service code<select name="code" required>${codeOptions(codebook, t.code)}</select></label>
        ${clientFieldsHtml(codebook, t.client, { label: 'Default client', blankLabel: 'Choose each time' })}
        <label>Default activity summary<span class="hint">Optional. Each day's notes get added to it.</span>
          <textarea name="summary" rows="3" maxlength="1000">${esc(t.summary)}</textarea></label>
        <label class="check"><input name="favorite" type="checkbox" ${t.favorite ? 'checked' : ''}> Favorite (shows first)</label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">${isNew ? 'Add task' : 'Save'}</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
        ${isNew ? '' : `<div class="danger-zone">
          <button class="button button-ghost-danger" type="button" data-delete>Delete task</button>
          <div class="confirm-delete" hidden><p>Delete “${esc(t.name)}”? Past entries keep their own copy.</p>
            <div class="button-row"><button class="button button-danger" type="button" data-confirm-delete>Delete</button>
            <button class="button button-soft" type="button" data-keep>Keep</button></div></div>
        </div>`}
      </form>`,
    onMount: (sheet, close) => {
      const form = sheet.querySelector('#task-form');
      const error = sheet.querySelector('.form-error');
      sheet.querySelector('[data-close]').addEventListener('click', close);
      wireClientFields(form);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = form.name.value.trim();
        const code = form.code.value;
        const client = readClient(form);
        const fail = (message, field) => { error.textContent = message; error.hidden = false; if (field) field.focus(); };
        if (!name) return fail('Give the task a name.', form.name);
        const duplicate = allTasks.some((x) => x.id !== t.id && x.name.toLowerCase() === name.toLowerCase());
        if (duplicate) return fail(`There's already a task called “${name}”.`, form.name);
        if (!code) return fail('Choose a service code.', form.code);
        const chosen = findCode(codebook, code);
        if (!chosen || chosen.active === false) return fail('That code is retired. Choose a current one.', form.code);
        if (client === null) return fail('Type the client’s name, or pick another option.', form.customClient);

        await store.saveTask({ ...t, name, code, client, summary: form.summary.value.trim(), favorite: form.favorite.checked });
        store.requestPersistence();
        close();
        toast(isNew ? `“${name}” added.` : `“${name}” saved.`);
      });

      const del = sheet.querySelector('[data-delete]');
      if (del) {
        const confirmBox = sheet.querySelector('.confirm-delete');
        del.addEventListener('click', () => { confirmBox.hidden = false; del.hidden = true; });
        sheet.querySelector('[data-keep]').addEventListener('click', () => { confirmBox.hidden = true; del.hidden = false; });
        sheet.querySelector('[data-confirm-delete]').addEventListener('click', async () => {
          await store.deleteTask(t.id);
          close();
          toast(`“${t.name}” deleted.`);
        });
      }
    },
  });
}
