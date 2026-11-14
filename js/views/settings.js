import { icons } from '../icons.js';
import { esc, heading, isStandalone } from '../ui.js';
import { checkForUpdate, getVersion } from '../sw-client.js';

const UPDATE_MESSAGES = {
  ready: 'A new version is ready. Tap Update in the banner at the top.',
  downloading: 'A new version is downloading. The Update banner will appear when it is ready.',
  current: 'You have the latest version.',
  unavailable: 'Couldn’t check right now. Try again when you’re online.',
};

export function render(el) {
  const where = isStandalone() ? 'Home Screen app' : 'Browser tab';
  el.innerHTML = `${heading('Settings')}
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
    </section>
    <section class="card">
      <h2>Your data</h2>
      <p>Nothing is saved yet. Starting with the next update, everything you log stays on this device. Backup files and sync come in later updates.</p>
    </section>`;

  getVersion().then((version) => {
    const target = el.querySelector('#app-version');
    if (target) target.textContent = version ? `v${version}` : 'Not available yet';
  });

  const button = el.querySelector('#check-update');
  const status = el.querySelector('#update-status');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Checking…';
    const result = await checkForUpdate();
    status.textContent = UPDATE_MESSAGES[result];
    button.disabled = false;
  });
}
