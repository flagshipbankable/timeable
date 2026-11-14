import { icons } from '../icons.js';
import { esc, heading, isStandalone, plural, prefs, shortDate, toast } from '../ui.js';
import { checkForUpdate, getVersion } from '../sw-client.js';
import { openSheet } from '../sheet.js';
import * as store from '../store.js';
import { activeCodes, applyCodebook, codeText, diffCodebooks, taskNeedsCode, validateCodebookFile } from '../codebook.js';
import { backupFileName, deliverFile, readJsonFile, validateBackupFile } from '../backup.js';

const UPDATE_MESSAGES = {
  ready: 'A new version is ready. Tap Update in the banner at the top.',
  downloading: 'A new version is downloading. The Update banner will appear when it is ready.',
  current: 'You have the latest version.',
  unavailable: 'Couldn’t check right now. Try again when you’re online.',
};

export async function render(el) {
  const [codebook, counts, persisted] = await Promise.all([store.getCodebook(), store.counts(), store.isPersisted()]);
  const where = isStandalone() ? 'Home Screen app' : 'Browser tab';
  const lastBackup = prefs.get('lastBackupAt', null);

  const codebookBody = codebook
    ? `<dl class="info-list">
         <div class="info-row"><dt>Service codes</dt><dd>${activeCodes(codebook).length} in use${codebook.codes.length > activeCodes(codebook).length ? `, ${codebook.codes.length - activeCodes(codebook).length} retired` : ''}</dd></div>
         <div class="info-row"><dt>Client choices</dt><dd>${codebook.clients.length}</dd></div>
         <div class="info-row"><dt>File dated</dt><dd>${esc(shortDate(codebook.updated) || 'Not given')}</dd></div>
         <div class="info-row"><dt>Loaded</dt><dd>${esc(shortDate(codebook.importedAt))}</dd></div>
       </dl>
       <div class="button-row">
         <button class="button button-soft" type="button" data-action="load-codebook">${icons.upload(18)} Load new code book</button>
         <a class="button button-soft" href="#codes">${icons.book(18)} Edit codes</a>
       </div>`
    : `<p>No code book yet. Load the code book file to fill the service code and client lists.</p>
       <div class="button-row"><button class="button" type="button" data-action="load-codebook">${icons.upload(18)} Load code book</button></div>`;

  el.innerHTML = `${heading('Settings')}
    <section class="card" id="codebook-card">
      <h2>Code book</h2>
      ${codebookBody}
      <input type="file" accept=".json,application/json" hidden data-input="codebook">
    </section>
    <section class="card" id="backup-card">
      <h2>Backup</h2>
      <p>Save a copy of everything in timeable to a file. On iPhone, choose <strong>Save to Files</strong> from the Share sheet.</p>
      <p class="muted small">Last backup from this device: ${esc(lastBackup ? shortDate(lastBackup) : 'never')}</p>
      <div class="button-row">
        <button class="button" type="button" data-action="export">${icons.download(18)} Export backup</button>
        <button class="button button-soft" type="button" data-action="import">${icons.upload(18)} Import backup</button>
      </div>
      <input type="file" accept=".json,application/json" hidden data-input="backup">
    </section>
    <section class="card">
      <h2>Your data</h2>
      <dl class="info-list">
        <div class="info-row"><dt>Tasks</dt><dd>${counts.tasks}</dd></div>
        <div class="info-row"><dt>Time entries</dt><dd>${counts.entries}</dd></div>
        <div class="info-row"><dt>Storage protection</dt><dd>${persisted === true ? 'On' : persisted === false ? 'Not yet' : 'Unknown'}</dd></div>
      </dl>
      <p class="muted small">Storage protection is a status, not a setting: it shows whether iPhone has agreed to keep timeable's data when space runs low. timeable asks automatically once you save something; iPhone decides, and it's more likely for Home Screen apps. Everything stays on this device, and backups are the safety net either way.</p>
    </section>
    <section class="card">
      <h2>App</h2>
      <dl class="info-list">
        <div class="info-row"><dt>Version</dt><dd id="app-version">Checking…</dd></div>
        <div class="info-row"><dt>Running as</dt><dd>${esc(where)}</dd></div>
      </dl>
      <p><button class="button button-soft" id="check-update" type="button">${icons.refresh(18)} Check for updates</button></p>
      <p class="muted small" id="update-status" aria-live="polite"></p>
    </section>
    <section class="card">
      <h2>Install on iPhone</h2>
      <ol class="steps">
        <li>Open timeable in Safari.</li>
        <li>Tap <strong>Share</strong> ${icons.share(16)}.</li>
        <li>Tap <strong>Add to Home Screen</strong>.</li>
        <li>Leave <strong>Open as Web App</strong> on, then tap <strong>Add</strong>.</li>
      </ol>
      <p class="muted small">After that, always open timeable from the Home Screen. iPhone keeps the Home Screen app's data separate from Safari's.</p>
    </section>`;

  getVersion().then((version) => {
    const target = el.querySelector('#app-version');
    if (target) target.textContent = version ? `v${version}` : 'Not available yet';
  });

  const updateButton = el.querySelector('#check-update');
  const status = el.querySelector('#update-status');
  updateButton.addEventListener('click', async () => {
    updateButton.disabled = true;
    status.textContent = 'Checking…';
    status.textContent = UPDATE_MESSAGES[await checkForUpdate()];
    updateButton.disabled = false;
  });

  const codebookInput = el.querySelector('[data-input="codebook"]');
  const backupInput = el.querySelector('[data-input="backup"]');
  el.querySelectorAll('[data-action="load-codebook"]').forEach((b) => b.addEventListener('click', () => codebookInput.click()));
  el.querySelector('[data-action="import"]').addEventListener('click', () => backupInput.click());
  el.querySelector('[data-action="export"]').addEventListener('click', exportBackup);

  codebookInput.addEventListener('change', async () => {
    const file = codebookInput.files[0];
    codebookInput.value = '';
    if (file) await reviewCodebook(file);
  });
  backupInput.addEventListener('change', async () => {
    const file = backupInput.files[0];
    backupInput.value = '';
    if (file) await reviewBackup(file);
  });
}

function showErrors(title, errors) {
  openSheet({
    title,
    bodyHtml: `<div class="notice notice-warn">${icons.warn(20)}<div><ul class="plain-list">${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>
      <div class="button-row"><button class="button" type="button" data-close autofocus>OK</button></div>`,
    onMount: (sheet, close) => sheet.querySelector('[data-close]').addEventListener('click', close),
  });
}

// ---- Code book import with a preview of every change

async function reviewCodebook(file) {
  const parsed = await readJsonFile(file);
  if (!parsed.ok) return showErrors('Couldn’t load that file', parsed.errors);
  const checked = validateCodebookFile(parsed.data);
  if (!checked.ok) return showErrors('Couldn’t load that code book', checked.errors);

  const current = await store.getCodebook();
  const tasks = await store.listTasks();
  const diff = diffCodebooks(current, checked.codebook);
  const proposed = applyCodebook(current, checked.codebook, store.now());
  const affected = tasks.filter((t) => taskNeedsCode(t, proposed) && !taskNeedsCode(t, current));

  const list = (items, fmt) => `<ul class="change-list">${items.map((i) => `<li>${fmt(i)}</li>`).join('')}</ul>`;
  const section = (title, items, fmt, cls = '') => items.length
    ? `<details class="change ${cls}" open><summary><strong>${esc(title)}</strong> <span class="count">${items.length}</span></summary>${list(items, fmt)}</details>` : '';

  const body = !diff.hasChanges
    ? `<p>No changes. This code book matches the one already on this device.</p>
       <div class="button-row"><button class="button" type="button" data-close autofocus>OK</button></div>`
    : `<p class="muted small">From a file dated ${esc(shortDate(checked.codebook.updated) || 'unknown')}. Nothing changes until you tap Apply.</p>
       ${current ? '' : `<p><strong>${plural(diff.added.length, 'service code')}</strong> and <strong>${plural(checked.codebook.clients.length, 'client choice')}</strong> will be added.</p>`}
       ${current ? section('Added', diff.added, (c) => esc(codeText(c))) : ''}
       ${section('Renamed', diff.renamed, (r) => `${esc(r.code)}: ${esc(r.from)} <span class="arrow">→</span> ${esc(r.to)}`)}
       ${section('Billable changed', diff.billableChanged, (c) => `${esc(codeText(c))}: now ${c.billable ? 'billable' : 'non-billable'}`)}
       ${section('Retired', diff.retired, (c) => esc(codeText(c)), 'change-warn')}
       ${section('Back in use', diff.restored, (c) => esc(codeText(c)))}
       ${current ? section('Client choices added', diff.clientsAdded, (c) => esc(c)) : ''}
       ${section('Client choices removed', diff.clientsRemoved, (c) => esc(c), 'change-warn')}
       ${current && diff.unchanged ? `<p class="muted small">${plural(diff.unchanged, 'code')} unchanged.</p>` : ''}
       ${affected.length ? `<div class="notice notice-warn">${icons.warn(20)}<p>${plural(affected.length, 'task')} will need a new code: ${affected.map((t) => esc(t.name)).join(', ')}. Past entries keep their old code.</p></div>` : ''}
       <div class="button-row">
         <button class="button" type="button" data-apply autofocus>Apply changes</button>
         <button class="button button-soft" type="button" data-close>Cancel</button>
       </div>`;

  openSheet({
    title: current ? 'Review code book changes' : 'Load code book',
    bodyHtml: body,
    onMount: (sheet, close) => {
      sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
      const apply = sheet.querySelector('[data-apply]');
      if (!apply) return;
      apply.addEventListener('click', async () => {
        apply.disabled = true;
        try {
          await store.saveCodebook(proposed);
          store.requestPersistence();
          close();
          toast(current ? 'Code book updated.' : 'Code book loaded.');
        } catch (error) {
          apply.disabled = false;
          showErrors('Couldn’t save the code book', [String(error.message || error)]);
        }
      });
    },
  });
}

// ---- Backup export and import

async function exportBackup() {
  try {
    const data = await store.exportAll();
    const result = await deliverFile(backupFileName(), JSON.stringify(data, null, 2));
    if (result === 'cancelled') return;
    prefs.set('lastBackupAt', store.now());
    toast(result === 'shared' ? 'Backup ready. Save it somewhere safe.' : 'Backup downloaded.');
    const card = document.querySelector('#backup-card .muted.small');
    if (card) card.textContent = `Last backup from this device: ${shortDate(store.now())}`;
  } catch (error) {
    showErrors('Couldn’t make a backup', [String(error.message || error)]);
  }
}

async function reviewBackup(file) {
  const parsed = await readJsonFile(file);
  if (!parsed.ok) return showErrors('Couldn’t read that file', parsed.errors);
  const checked = validateBackupFile(parsed.data);
  if (!checked.ok) return showErrors('Couldn’t import that backup', checked.errors);
  const here = await store.counts();
  const hasData = here.tasks > 0 || here.entries > 0 || Boolean(await store.getCodebook());
  const s = checked.summary;

  openSheet({
    title: 'Import backup',
    bodyHtml: `<dl class="info-list">
        <div class="info-row"><dt>Made on</dt><dd>${esc(shortDate(s.exportedAt) || 'Unknown')}</dd></div>
        <div class="info-row"><dt>Service codes</dt><dd>${s.codes}</dd></div>
        <div class="info-row"><dt>Tasks</dt><dd>${s.tasks}</dd></div>
        <div class="info-row"><dt>Time entries</dt><dd>${s.entries}</dd></div>
      </dl>
      ${hasData ? `<div class="notice notice-warn">${icons.warn(20)}<p>This <strong>replaces everything</strong> on this device (${plural(here.tasks, 'task')}, ${plural(here.entries, 'time entry', 'time entries')}). Export a backup first if you might need what's here.</p></div>` : ''}
      <div class="button-row">
        <button class="button ${hasData ? 'button-danger' : ''}" type="button" data-confirm autofocus>${hasData ? 'Replace everything' : 'Import'}</button>
        <button class="button button-soft" type="button" data-close>Cancel</button>
      </div>`,
    onMount: (sheet, close) => {
      sheet.querySelector('[data-close]').addEventListener('click', close);
      const confirm = sheet.querySelector('[data-confirm]');
      confirm.addEventListener('click', async () => {
        confirm.disabled = true;
        try {
          await store.replaceAll(checked.backup);
          store.requestPersistence();
          close();
          toast('Backup imported.');
        } catch (error) {
          confirm.disabled = false;
          showErrors('Couldn’t import the backup', [String(error.message || error)]);
        }
      });
    },
  });
}
