// Code book logic: checking a code book file, working out what changed,
// and applying the change. No screens or storage here, so it can be tested
// on its own.

export const CODEBOOK_FORMAT = 'timeable-codebook';

// Checks a parsed code book file. Returns { ok, errors, codebook }.
// Error messages are written for Josh, not for developers.
export function validateCodebookFile(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['This file isn’t a timeable code book.'] };
  }
  if (data.format !== CODEBOOK_FORMAT) {
    return { ok: false, errors: ['This file isn’t a timeable code book. (If it’s a backup, use Import backup instead.)'] };
  }
  if (data.formatVersion !== 1) errors.push(`This code book uses format version ${data.formatVersion}, which this version of timeable doesn’t know. Update the app and try again.`);
  if (!Array.isArray(data.codes) || data.codes.length === 0) errors.push('The code book has no service codes.');
  if (data.clients !== undefined && !Array.isArray(data.clients)) errors.push('The client list isn’t in the expected format.');

  const seen = new Set();
  const codes = [];
  (Array.isArray(data.codes) ? data.codes : []).forEach((c, i) => {
    const where = `Code #${i + 1}`;
    if (!c || typeof c !== 'object') { errors.push(`${where} is not readable.`); return; }
    const code = typeof c.code === 'string' ? c.code.trim() : '';
    const label = typeof c.label === 'string' ? c.label.trim() : '';
    if (!code) { errors.push(`${where} has no code number.`); return; }
    if (!label) errors.push(`Code ${code} has no label.`);
    if (typeof c.billable !== 'boolean') errors.push(`Code ${code} doesn’t say whether it’s billable.`);
    if (seen.has(code)) errors.push(`Code ${code} appears more than once.`);
    seen.add(code);
    codes.push({ code, label, billable: c.billable === true });
  });

  const clients = [];
  for (const name of Array.isArray(data.clients) ? data.clients : []) {
    const clean = typeof name === 'string' ? name.trim() : '';
    if (clean && !clients.includes(clean)) clients.push(clean);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    codebook: { updated: typeof data.updated === 'string' ? data.updated : '', codes, clients },
  };
}

// Compares the code book on this device (or null) with an incoming one.
export function diffCodebooks(current, incoming) {
  const before = new Map((current ? current.codes : []).map((c) => [c.code, c]));
  const after = new Map(incoming.codes.map((c) => [c.code, c]));
  const diff = { added: [], renamed: [], billableChanged: [], retired: [], restored: [], unchanged: 0, clientsAdded: [], clientsRemoved: [] };

  for (const [code, next] of after) {
    const prev = before.get(code);
    if (!prev) { diff.added.push(next); continue; }
    let same = true;
    if (prev.active === false) { diff.restored.push(next); same = false; }
    if (prev.label !== next.label) { diff.renamed.push({ code, from: prev.label, to: next.label }); same = false; }
    if (prev.billable !== next.billable) { diff.billableChanged.push({ code, label: next.label, billable: next.billable }); same = false; }
    if (same) diff.unchanged += 1;
  }
  for (const [code, prev] of before) {
    if (!after.has(code) && prev.active !== false) diff.retired.push(prev);
  }

  const oldClients = current ? current.clients : [];
  diff.clientsAdded = incoming.clients.filter((c) => !oldClients.includes(c));
  diff.clientsRemoved = oldClients.filter((c) => !incoming.clients.includes(c));
  diff.hasChanges = Boolean(diff.added.length || diff.renamed.length || diff.billableChanged.length
    || diff.retired.length || diff.restored.length || diff.clientsAdded.length || diff.clientsRemoved.length);
  return diff;
}

// Builds the code book record to save. Codes missing from the new file are
// kept but marked retired, so old entries and tasks still show their labels.
export function applyCodebook(current, incoming, importedAt) {
  const incomingCodes = new Set(incoming.codes.map((c) => c.code));
  const codes = incoming.codes.map((c) => ({ ...c, active: true }));
  for (const old of current ? current.codes : []) {
    if (!incomingCodes.has(old.code)) codes.push({ ...old, active: false });
  }
  codes.sort(compareCodes);
  return {
    version: (current ? current.version : 0) + 1,
    updated: incoming.updated,
    importedAt,
    codes,
    clients: [...incoming.clients],
  };
}

// Sorts "9150" after "9100" and before "9200", numbers first.
export function compareCodes(a, b) {
  return a.code.localeCompare(b.code, 'en', { numeric: true });
}

export function activeCodes(codebook) {
  return codebook ? codebook.codes.filter((c) => c.active !== false) : [];
}

export function findCode(codebook, code) {
  return codebook ? codebook.codes.find((c) => c.code === code) || null : null;
}

export function codeText(c) {
  return c ? `${c.code} ${c.label}` : '';
}

// A task needs a new code when its code is retired or missing.
export function taskNeedsCode(task, codebook) {
  const c = findCode(codebook, task.code);
  return !c || c.active === false;
}

// Groups codes by thousands for the picker, e.g. 8000s, 9000s. A group's
// title is its x000 code's label when one exists.
export function groupCodes(codes) {
  const groups = new Map();
  for (const c of [...codes].sort(compareCodes)) {
    const key = /^\d/.test(c.code) ? `${c.code[0]}000` : 'Other';
    if (!groups.has(key)) groups.set(key, { key, title: '', codes: [] });
    groups.get(key).codes.push(c);
  }
  for (const g of groups.values()) {
    const head = g.codes.find((c) => c.code === g.key);
    g.title = head ? `${head.code} ${head.label}` : (g.key === 'Other' ? 'Other codes' : `${g.key}s`);
  }
  return [...groups.values()];
}

// Validates a single code typed into the code editor.
export function validateNewCode(codebook, code, label) {
  const c = (code || '').trim();
  const l = (label || '').trim();
  if (!c) return 'Enter a code number.';
  if (!l) return 'Enter a label.';
  if (findCode(codebook, c)) return `Code ${c} is already in the code book.`;
  return null;
}
