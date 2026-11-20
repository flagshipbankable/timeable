// The Sync section of Settings: set up, status, Sync now, fixes for problems,
// and turning sync off on this device. The work itself is in sync.js.

import { icons } from '../icons.js';
import { esc, plural, shortDate, toast } from '../ui.js';
import { openSheet } from '../sheet.js';
import { formatTime, localDate } from '../time.js';
import * as sync from '../sync.js';

const STATE_TEXT = {
  idle: 'Waiting to sync',
  syncing: 'Syncing…',
  ok: 'Up to date',
  offline: 'Offline',
  error: 'Not synced',
};

function lastSyncedText(iso) {
  if (!iso) return 'Not yet';
  const date = new Date(iso);
  return localDate(date) === localDate() ? `Today, ${formatTime(iso)}` : `${shortDate(iso)}, ${formatTime(iso)}`;
}

function problemHtml(problem) {
  if (!problem) return '';
  const fix = problem.kind === 'auth' ? '<button class="button button-small" type="button" data-sync="token">Paste a new token</button>'
    : problem.kind === 'wrong-key' ? '<button class="button button-small" type="button" data-sync="passphrase">Enter passphrase</button>'
      : '';
  return `<div class="notice ${problem.needsAction ? 'notice-warn' : ''}">${icons.warn(20)}<div><p>${esc(problem.text)}</p>${fix ? `<div class="button-row">${fix}</div>` : ''}</div></div>`;
}

export function syncCardHtml(status) {
  if (status.state === 'off') {
    return `<section class="card" id="sync-card">
      <h2>Sync</h2>
      <p>Keep this device and your other device in step, through your own private GitHub repo. Everything is encrypted on this device before it leaves.</p>
      <div class="button-row"><button class="button" type="button" data-sync="setup">${icons.refresh(18)} Set up sync</button></div>
    </section>`;
  }
  return `<section class="card" id="sync-card">
      <h2>Sync</h2>
      <dl class="info-list">
        <div class="info-row"><dt>Status</dt><dd data-sync-field="state">${esc(STATE_TEXT[status.state] || '')}</dd></div>
        <div class="info-row"><dt>Last synced</dt><dd data-sync-field="last">${esc(lastSyncedText(status.lastSyncAt))}</dd></div>
        <div class="info-row"><dt>Waiting to send</dt><dd data-sync-field="waiting">${esc(plural(status.waiting || 0, 'change'))}</dd></div>
        <div class="info-row"><dt>Data repo</dt><dd class="wrap-anywhere">${esc(status.repo || '')}</dd></div>
      </dl>
      <div data-sync-field="problem">${problemHtml(status.problem)}</div>
      <div class="button-row">
        <button class="button" type="button" data-sync="now">${icons.refresh(18)} Sync now</button>
        <button class="button button-soft" type="button" data-sync="off">Turn off on this device</button>
      </div>
      <p class="muted small">Everything is encrypted with your passphrase before it leaves this device. GitHub only stores scrambled files.</p>
    </section>`;
}

// Keeps the card's status lines current while Settings is open.
export function wireSyncCard(root) {
  const card = root.querySelector('#sync-card');
  if (!card) return;
  const on = (name, fn) => { const b = card.querySelector(`[data-sync="${name}"]`); if (b) b.addEventListener('click', fn); };
  on('setup', openSetup);
  on('off', openTurnOff);
  on('now', async () => {
    const button = card.querySelector('[data-sync="now"]');
    button.disabled = true;
    await sync.syncNow();
    button.disabled = false;
    const s = sync.getStatus();
    if (!s.problem) toast('Synced.');
  });
  const wireFixes = () => {
    const token = card.querySelector('[data-sync="token"]');
    if (token) token.addEventListener('click', openTokenSheet);
    const pass = card.querySelector('[data-sync="passphrase"]');
    if (pass) pass.addEventListener('click', openPassphraseSheet);
  };
  wireFixes();
  let lastProblem = JSON.stringify(sync.getStatus().problem);
  const stop = sync.onStatus((s) => {
    if (!card.isConnected) { stop(); return; }
    if (s.state === 'off') return; // the screen redraws when sync is turned off
    const set = (field, text) => { const el = card.querySelector(`[data-sync-field="${field}"]`); if (el) el.textContent = text; };
    set('state', STATE_TEXT[s.state] || '');
    set('last', lastSyncedText(s.lastSyncAt));
    set('waiting', plural(s.waiting || 0, 'change'));
    const problem = JSON.stringify(s.problem);
    if (problem !== lastProblem) {
      lastProblem = problem;
      card.querySelector('[data-sync-field="problem"]').innerHTML = problemHtml(s.problem);
      wireFixes();
    }
  });
}

// ---- Shared bits for the sheets

const field = (name, label, { type = 'text', hint = '', placeholder = '' } = {}) =>
  `<label>${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
    <input name="${name}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>`;

function errorBox(sheet) {
  const el = sheet.querySelector('.form-error');
  return {
    show(message, input) { el.textContent = message; el.hidden = false; if (input) input.focus(); },
    clear() { el.hidden = true; },
  };
}

// Runs a step with the button showing what's happening, and shows any
// problem in the form instead of closing it.
async function busy(button, text, error, fn) {
  const label = button.innerHTML;
  button.disabled = true;
  button.textContent = text;
  error.clear();
  try {
    return await fn();
  } catch (e) {
    error.show(e.message || String(e));
    return undefined;
  } finally {
    if (button.isConnected) { button.disabled = false; button.innerHTML = label; }
  }
}

function afterTurnOn(close) {
  close();
  const s = sync.getStatus();
  if (s.problem && s.problem.needsAction) toast(`Sync is on, but: ${s.problem.text}`, { duration: 8000 });
  else if (s.state === 'offline') toast('Sync is on. It will finish when you’re back online.');
  else toast('Sync is on. This device is up to date.');
}

// ---- Set up: repo and token, then the passphrase

const HOW_TO = `<details class="howto"><summary>How to make the repo and token</summary>
    <ol class="steps">
      <li>On github.com, create a new repository. Choose <strong>Private</strong>. Use it only for timeable's data.</li>
      <li>Go to <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong>, then <strong>Generate new token</strong>.</li>
      <li>Under <strong>Repository access</strong>, choose <strong>Only select repositories</strong> and pick the data repo.</li>
      <li>Under <strong>Permissions</strong>, set <strong>Contents</strong> to <strong>Read and write</strong>. Nothing else is needed.</li>
      <li>Generate it, copy it, and keep it in your password manager. Use the same token on each device.</li>
    </ol>
  </details>`;

function openSetup() {
  openSheet({
    title: 'Set up sync',
    bodyHtml: '<div data-step></div>',
    onMount(sheet, close) {
      const stepEl = sheet.querySelector('[data-step]');
      const show = (html, wire) => { stepEl.innerHTML = html; wire(); };

      const repoStep = () => show(`<form class="form" novalidate>
          <p>Sync uses a private GitHub repo that only you can reach. timeable encrypts everything before sending it.</p>
          ${HOW_TO}
          ${field('repo', 'Data repo', { hint: 'Owner and name, like your-name/timeable-data', placeholder: 'owner/repo-name' })}
          ${field('token', 'Token', { type: 'password', hint: 'A fine-grained token that starts with github_pat_' })}
          <p class="form-error" role="alert" hidden></p>
          <div class="button-row">
            <button class="button" type="submit">Continue</button>
            <button class="button button-soft" type="button" data-close>Cancel</button>
          </div>
        </form>`, () => {
        const form = stepEl.querySelector('form');
        const error = errorBox(stepEl);
        stepEl.querySelector('[data-close]').addEventListener('click', close);
        form.repo.focus();
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const checked = await busy(form.querySelector('[type="submit"]'), 'Checking…', error,
            () => sync.checkRepo(form.repo.value, form.token.value));
          if (checked) passStep(checked);
        });
      });

      const passStep = (checked) => show(checked.existing
        ? `<form class="form" novalidate>
            <p>Sync is already set up in <strong>${esc(checked.repo)}</strong>. Enter the passphrase you chose when you set it up.</p>
            ${field('pass', 'Passphrase', { type: 'password' })}
            <p class="form-error" role="alert" hidden></p>
            <div class="button-row">
              <button class="button" type="submit">Turn on sync</button>
              <button class="button button-soft" type="button" data-back>Back</button>
            </div>
            <div class="sheet-links"><button class="link-button" type="button" data-forgot>Forgot it? Start over with a new passphrase</button></div>
          </form>`
        : `<form class="form" novalidate>
            <p>Choose a passphrase. It locks your data before it leaves this device, and you'll type it once on each device.</p>
            <div class="notice notice-warn">${icons.warn(20)}<p>Save it in your password manager now. If it's lost, the copy on GitHub can't be opened. Each device still keeps everything, and sync can be set up again.</p></div>
            ${field('pass', 'Passphrase', { type: 'password', hint: `At least ${sync.MIN_PASSPHRASE} characters. A few random words works well.` })}
            ${field('again', 'Type it again', { type: 'password' })}
            <p class="form-error" role="alert" hidden></p>
            <div class="button-row">
              <button class="button" type="submit">Turn on sync</button>
              <button class="button button-soft" type="button" data-back>Back</button>
            </div>
          </form>`, () => {
        const form = stepEl.querySelector('form');
        const error = errorBox(stepEl);
        stepEl.querySelector('[data-back]').addEventListener('click', repoStep);
        const forgot = stepEl.querySelector('[data-forgot]');
        if (forgot) forgot.addEventListener('click', () => startOverStep(checked));
        form.pass.focus();
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (!checked.existing) {
            const problem = sync.passphraseProblem(form.pass.value, form.again.value);
            if (problem) { error.show(problem, form.pass); return; }
          }
          const done = await busy(form.querySelector('[type="submit"]'), 'Turning on sync…', error, async () => {
            await sync.turnOn(checked, form.pass.value);
            return true;
          });
          if (done) afterTurnOn(close);
        });
      });

      const startOverStep = (checked) => show(`<div class="form">
          <p>This removes timeable's sync files from <strong>${esc(checked.repo)}</strong>, so you can choose a new passphrase.</p>
          <ul class="plain-list bullets">
            <li>Everything on your devices stays.</li>
            <li>Your other device will ask for the new passphrase, then send its data again.</li>
          </ul>
          <p class="form-error" role="alert" hidden></p>
          <div class="button-row">
            <button class="button button-danger" type="button" data-confirm>Remove sync files and start over</button>
            <button class="button button-soft" type="button" data-back>Back</button>
          </div>
        </div>`, () => {
        const error = errorBox(stepEl);
        stepEl.querySelector('[data-back]').addEventListener('click', () => passStep(checked));
        const confirm = stepEl.querySelector('[data-confirm]');
        confirm.addEventListener('click', async () => {
          const fresh = await busy(confirm, 'Removing old sync files…', error, () => sync.startOver(checked));
          if (fresh) passStep(fresh);
        });
      });

      repoStep();
    },
  });
}

// ---- Fixes for problems that need Josh

function openTokenSheet() {
  openSheet({
    title: 'Paste a new token',
    bodyHtml: `<form class="form" novalidate>
        <p>GitHub stopped accepting this device's token. Make a new fine-grained token for the data repo (Contents: Read and write), then paste it here.</p>
        ${field('token', 'Token', { type: 'password', hint: 'Starts with github_pat_' })}
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">Save and sync</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const error = errorBox(sheet);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      form.token.focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const done = await busy(form.querySelector('[type="submit"]'), 'Checking…', error, async () => {
          await sync.updateToken(form.token.value);
          return true;
        });
        if (done) { close(); toast(sync.getStatus().problem ? sync.getStatus().problem.text : 'Token saved. Synced.'); }
      });
    },
  });
}

function openPassphraseSheet() {
  openSheet({
    title: 'Enter the sync passphrase',
    bodyHtml: `<form class="form" novalidate>
        <p>Sync was set up again with a new passphrase. Enter it here. This device then sends its data again, so nothing is lost.</p>
        ${field('pass', 'Passphrase', { type: 'password' })}
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">Save and sync</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const error = errorBox(sheet);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      form.pass.focus();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const done = await busy(form.querySelector('[type="submit"]'), 'Checking…', error, async () => {
          await sync.updatePassphrase(form.pass.value);
          return true;
        });
        if (done) { close(); toast(sync.getStatus().problem ? sync.getStatus().problem.text : 'Passphrase saved. Synced.'); }
      });
    },
  });
}

// ---- Turn off on this device

function openTurnOff() {
  const status = sync.getStatus();
  openSheet({
    title: 'Turn off sync on this device',
    bodyHtml: `<form class="form" novalidate>
        <p>This device stops syncing and forgets the token and passphrase. Your other device and the data repo don't change.</p>
        ${status.waiting ? `<div class="notice notice-warn">${icons.warn(20)}<p>${plural(status.waiting, 'change')} from this device ${status.waiting === 1 ? 'hasn’t' : 'haven’t'} been sent yet, so your other device won't get ${status.waiting === 1 ? 'it' : 'them'}.</p></div>` : ''}
        <fieldset class="choices"><legend class="sr-only">What to do with this device's data</legend>
          <label class="choice"><input type="radio" name="data" value="keep" checked>
            <span class="choice-body"><span class="choice-title">Keep timeable's data on this device</span>
            <span class="choice-sub">Tasks and time stay here, just no longer synced.</span></span></label>
          <label class="choice"><input type="radio" name="data" value="remove">
            <span class="choice-body"><span class="choice-title">Remove timeable's data from this device</span>
            <span class="choice-sub">Clears tasks, time, and the code book here. Export a backup first if you might need it.</span></span></label>
        </fieldset>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button" type="submit">Turn off sync</button>
          <button class="button button-soft" type="button" data-close>Cancel</button>
        </div>
      </form>`,
    onMount(sheet, close) {
      const form = sheet.querySelector('form');
      const submit = form.querySelector('[type="submit"]');
      const error = errorBox(sheet);
      sheet.querySelector('[data-close]').addEventListener('click', close);
      form.addEventListener('change', () => {
        const remove = form.data.value === 'remove';
        submit.classList.toggle('button-danger', remove);
        submit.textContent = remove ? 'Turn off and remove data' : 'Turn off sync';
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const removeData = form.data.value === 'remove';
        const done = await busy(submit, 'Turning off…', error, async () => {
          await sync.turnOff({ removeData });
          return true;
        });
        if (done) { close(); toast(removeData ? 'Sync is off, and this device’s data was removed.' : 'Sync is off on this device.'); }
      });
    },
  });
}
