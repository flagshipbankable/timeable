// Form pieces shared by the task and entry forms: the service code picker,
// the client picker (standard choices or a typed name), and the optional
// extras (travel, prep, miles, destination, expenses).

import { esc } from './ui.js';
import { activeCodes, codeText, findCode, groupCodes } from './codebook.js';

export const CUSTOM_CLIENT = '__custom__';

// Options for a service code <select>. A retired or unknown current code
// stays selectable so editing an old record doesn't silently change it.
export function codeOptions(codebook, selected, { optional = false } = {}) {
  const current = selected ? findCode(codebook, selected) : null;
  const keepOld = selected && (!current || current.active === false)
    ? `<option value="${esc(selected)}" selected>${esc(current ? codeText(current) : selected)} (retired)</option>` : '';
  const groups = groupCodes(activeCodes(codebook)).map((g) => `<optgroup label="${esc(g.title)}">${g.codes.map((c) =>
    `<option value="${esc(c.code)}" ${c.code === selected ? 'selected' : ''}>${esc(codeText(c))}${c.billable ? '' : ' (non-billable)'}</option>`).join('')}</optgroup>`).join('');
  const first = optional
    ? `<option value="" ${selected ? '' : 'selected'}>No code yet</option>`
    : `<option value="" ${selected ? '' : 'selected'} disabled>Choose a service code</option>`;
  return first + keepOld + groups;
}

// A client <select> plus a text box for a specific client's name.
export function clientFieldsHtml(codebook, client, { label = 'Client', blankLabel = 'None yet', hint = '' } = {}) {
  const standard = codebook ? codebook.clients : [];
  const isCustom = Boolean(client) && !standard.includes(client);
  return `<label>${esc(label)}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}<select name="client">
      <option value="" ${client ? '' : 'selected'}>${esc(blankLabel)}</option>
      ${standard.map((c) => `<option value="${esc(c)}" ${c === client ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      <option value="${CUSTOM_CLIENT}" ${isCustom ? 'selected' : ''}>A specific client…</option>
    </select></label>
    <label class="custom-client" ${isCustom ? '' : 'hidden'}>Client name
      <input name="customClient" type="text" maxlength="120" value="${esc(isCustom ? client : '')}" autocomplete="off"></label>`;
}

export function wireClientFields(form) {
  const box = form.querySelector('.custom-client');
  form.client.addEventListener('change', () => {
    box.hidden = form.client.value !== CUSTOM_CLIENT;
    if (!box.hidden) form.customClient.focus();
  });
}

// The chosen client, or null if "a specific client" was picked but left blank.
export function readClient(form) {
  if (form.client.value !== CUSTOM_CLIENT) return form.client.value;
  const typed = form.customClient.value.trim();
  return typed || null;
}

const amount = (n) => (n ? String(n) : '');

// Travel, prep, miles, destination, expenses. Folded away unless used.
export function extrasFieldsHtml(entry = {}) {
  const used = entry.travelHours || entry.prepHours || entry.miles || entry.expenses || entry.destination;
  return `<details class="extras" ${used ? 'open' : ''}>
      <summary>Travel, prep, miles, and expenses</summary>
      <div class="form-two">
        <label>Travel hours<input name="travelHours" type="text" inputmode="decimal" placeholder="0.00" value="${esc(amount(entry.travelHours))}"></label>
        <label>Prep hours<input name="prepHours" type="text" inputmode="decimal" placeholder="0.00" value="${esc(amount(entry.prepHours))}"></label>
        <label>Miles<input name="miles" type="text" inputmode="decimal" placeholder="0.00" value="${esc(amount(entry.miles))}"></label>
        <label>Expenses ($)<input name="expenses" type="text" inputmode="decimal" placeholder="0.00" value="${esc(amount(entry.expenses))}"></label>
      </div>
      <label>Destination<input name="destination" type="text" maxlength="120" value="${esc(entry.destination || '')}" autocomplete="off"></label>
    </details>`;
}

export function extrasFromForm(form) {
  return {
    travelHours: form.travelHours.value,
    prepHours: form.prepHours.value,
    miles: form.miles.value,
    expenses: form.expenses.value,
    destination: form.destination.value,
  };
}
