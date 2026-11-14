// Code book editor, reached from Settings. For small changes between code
// book files: rename a code, change billable, retire or restore, add a code,
// and manage the standard client choices.

import { icons } from '../icons.js';
import { esc, plural, toast } from '../ui.js';
import { openSheet } from '../sheet.js';
import * as store from '../store.js';
import { codeText, compareCodes, findCode, validateNewCode } from '../codebook.js';

let search = '';

export async function render(el) {
  const codebook = await store.getCodebook();
  const back = `<a class="back-link" href="#settings">${icons.back(18)} Settings</a>`;
  if (!codebook) {
    el.innerHTML = `${back}<div class="view-heading"><h1>Code book</h1></div>
      <section class="card"><p>No code book yet. Load one from Settings first.</p></section>`;
    return;
  }

  el.innerHTML = `${back}
    <div class="view-heading"><h1>Code book</h1><p>Small fixes between code book files. Changes apply to new entries; past entries keep their copy.</p></div>
    <section class="card">
      <h2>Client choices</h2>
      <ul class="row-list" id="client-list">${codebook.clients.map((c, i) => `
        <li class="row"><span class="row-main">${esc(c)}</span>
          <button class="icon-button" type="button" data-remove-client="${i}" aria-label="Remove ${esc(c)}">${icons.close(18)}</button></li>`).join('')}
      </ul>
      <form class="inline-form" id="add-client">
        <label class="sr-only" for="new-client">New client choice</label>
        <input id="new-client" type="text" maxlength="80" placeholder="Add a client choice" autocomplete="off">
        <button class="button button-soft" type="submit">${icons.plus(18)} Add</button>
      </form>
    </section>
    <section class="card">
      <div class="card-head"><h2>Service codes</h2>
        <button class="button button-soft" type="button" id="add-code">${icons.plus(18)} Add code</button></div>
      <label class="sr-only" for="code-search">Search codes</label>
      <input id="code-search" type="search" placeholder="Search by number or name" value="${esc(search)}" autocomplete="off">
      <ul class="row-list" id="code-list"></ul>
    </section>`;

  const listEl = el.querySelector('#code-list');
  const drawCodes = () => {
    const q = search.trim().toLowerCase();
    const shown = [...codebook.codes].sort(compareCodes)
      .filter((c) => !q || c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q));
    listEl.innerHTML = shown.length ? shown.map((c) => `
      <li><button class="row row-button" type="button" data-code="${esc(c.code)}">
        <span class="row-main"><strong>${esc(c.code)}</strong> ${esc(c.label)}</span>
        <span class="tags">${c.active === false ? '<span class="tag tag-retired">Retired</span>' : ''}<span class="tag ${c.billable ? 'tag-billable' : ''}">${c.billable ? 'Billable' : 'Non-billable'}</span></span>
      </button></li>`).join('') : '<li class="muted small">No codes match.</li>';
  };
  drawCodes();

  el.querySelector('#code-search').addEventListener('input', (e) => { search = e.target.value; drawCodes(); });
  listEl.addEventListener('click', (e) => {
    const button = e.target.closest('[data-code]');
    if (button) editCode(codebook, button.dataset.code);
  });
  el.querySelector('#add-code').addEventListener('click', () => addCode(codebook));

  el.querySelector('#add-client').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el.querySelector('#new-client');
    const name = input.value.trim();
    if (!name) return;
    if (codebook.clients.some((c) => c.toLowerCase() === name.toLowerCase())) { toast('That client choice is already in the list.'); return; }
    await save(codebook, { clients: [...codebook.clients, name] });
    toast('Client choice added.');
  });
  el.querySelector('#client-list').addEventListener('click', async (e) => {
    const button = e.target.closest('[data-remove-client]');
    if (!button) return;
    const clients = codebook.clients.filter((_, i) => i !== Number(button.dataset.removeClient));
    await save(codebook, { clients });
    toast('Client choice removed. Tasks that use it keep it.');
  });
}

function save(codebook, changes) {
  return store.saveCodebook({ ...codebook, ...changes, version: codebook.version + 1 });
}

async function editCode(codebook, code) {
  const c = findCode(codebook, code);
  if (!c) return;
  const tasks = (await store.listTasks()).filter((t) => t.code === code);
  const retired = c.active === false;
  openSheet({
    title: `Code ${c.code}`,
    bodyHtml: `<form class="form" id="code-form">
        <label>Label<input name="label" type="text" required maxlength="120" value="${esc(c.label)}" autofocus></label>
        <label>Billing<select name="billable">
          <option value="yes" ${c.billable ? 'selected' : ''}>Billable</option>
          <option value="no" ${c.billable ? '' : 'selected'}>Non-billable</option></select></label>
        <p class="muted small">${tasks.length ? `Used by ${plural(tasks.length, 'task')}: ${tasks.map((t) => esc(t.name)).join(', ')}.` : 'No tasks use this code.'}</p>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">Save</button>
          <button class="button button-soft" type="button" data-toggle>${retired ? 'Bring back into use' : 'Retire code'}</button>
        </div>
        ${!retired && tasks.length ? `<p class="muted small">Retiring flags ${tasks.length === 1 ? 'that task' : 'those tasks'} as needing a new code.</p>` : ''}
      </form>`,
    onMount: (sheet, close) => {
      const form = sheet.querySelector('#code-form');
      const error = sheet.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const label = form.label.value.trim();
        if (!label) { error.textContent = 'Enter a label.'; error.hidden = false; return; }
        const codes = codebook.codes.map((x) => (x.code === code ? { ...x, label, billable: form.billable.value === 'yes' } : x));
        await save(codebook, { codes });
        close();
        toast(`Code ${code} saved.`);
      });
      sheet.querySelector('[data-toggle]').addEventListener('click', async () => {
        const codes = codebook.codes.map((x) => (x.code === code ? { ...x, active: retired } : x));
        await save(codebook, { codes });
        close();
        toast(retired ? `Code ${code} is back in use.` : `Code ${code} retired.`);
      });
    },
  });
}

function addCode(codebook) {
  openSheet({
    title: 'Add a service code',
    bodyHtml: `<form class="form" id="new-code-form">
        <label>Code number<input name="code" type="text" inputmode="numeric" maxlength="12" required autofocus></label>
        <label>Label<input name="label" type="text" maxlength="120" required placeholder="e.g. Category - Stage - Activity"></label>
        <label>Billing<select name="billable"><option value="yes">Billable</option><option value="no">Non-billable</option></select></label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row"><button class="button" type="submit">Add code</button></div>
      </form>`,
    onMount: (sheet, close) => {
      const form = sheet.querySelector('#new-code-form');
      const error = sheet.querySelector('.form-error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const problem = validateNewCode(codebook, form.code.value, form.label.value);
        if (problem) { error.textContent = problem; error.hidden = false; return; }
        const added = { code: form.code.value.trim(), label: form.label.value.trim(), billable: form.billable.value === 'yes', active: true };
        await save(codebook, { codes: [...codebook.codes, added].sort(compareCodes) });
        close();
        toast(`${codeText(added)} added.`);
      });
    },
  });
}
