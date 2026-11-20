// The only file that reads and writes saved data. Everything lives in
// IndexedDB on this device. Records are sync-ready: random IDs, updatedAt
// times, and a deleted flag instead of real deletes.

import { timelineProblem } from './timeline.js';

const DB_NAME = 'timeable';
export const SCHEMA_VERSION = 1;

// Stores created in schema version 1. Entries and portal marks are unused
// until Phases 3 and 4, but they exist now so no migration is needed then.
const STORES = {
  meta: { keyPath: 'key' },
  codebook: { keyPath: 'id' },
  tasks: { keyPath: 'id' },
  entries: { keyPath: 'id', indexes: [['workDate', 'workDate']] },
  portalMarks: { keyPath: 'key' },
};

let dbPromise = null;
const listeners = new Set();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [indexName, keyPath] of def.indexes || []) store.createIndex(indexName, keyPath);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // If another tab upgrades the database later, step aside cleanly.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('timeable is open in another tab. Close it and try again.'));
  });
  return dbPromise;
}

// Runs fn inside one transaction and resolves when it has fully committed,
// so a save is only reported once it's actually on disk.
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Save was cancelled.'));
    const fail = (error) => {
      try { tx.abort(); } catch { /* already finished */ }
      reject(error);
    };
    let value;
    try {
      value = fn(tx);
    } catch (error) {
      fail(error);
      return;
    }
    Promise.resolve(value).then((v) => { result = v; }, fail);
  });
}

const req = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function changed(what) {
  for (const fn of listeners) {
    try { fn(what); } catch (error) { console.error(error); }
  }
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

// ---- Outbox: what changed on this device and hasn't been sent yet
// Every local save notes the record in the meta store, in the same
// transaction as the save, so nothing changed here is ever missed by sync.
// One note per record: saving it again just updates the note's time.

// The stores sync copies between devices, and each one's key field.
export const SYNCED_STORES = { codebook: 'id', tasks: 'id', entries: 'id', portalMarks: 'key' };
const OUTBOX = 'outbox:';
const outboxKey = (storeName, id) => `${OUTBOX}${storeName}:${id}`;
const outboxRange = () => IDBKeyRange.bound(OUTBOX, `${OUTBOX}￿`);
// Sync settings and progress live in the meta store under these keys. They
// never go into backup files (the token stays on this device).
const PRIVATE_META = new Set(['sync', 'syncState']);
const isPrivateMeta = (key) => PRIVATE_META.has(key) || String(key).startsWith(OUTBOX);

function queue(tx, storeName, id, stamp) {
  tx.objectStore('meta').put({ key: outboxKey(storeName, id), store: storeName, id, at: stamp });
}

// ---- Code book (one record, id "current")

export async function getCodebook() {
  return run(['codebook'], 'readonly', (tx) => req(tx.objectStore('codebook').get('current'))).then((r) => r || null);
}

export async function saveCodebook(codebook) {
  const record = { ...codebook, id: 'current', updatedAt: now() };
  await run(['codebook', 'meta'], 'readwrite', (tx) => {
    queue(tx, 'codebook', record.id, record.updatedAt);
    return req(tx.objectStore('codebook').put(record));
  });
  changed('codebook');
  return record;
}

// ---- Tasks

export async function listTasks({ includeDeleted = false } = {}) {
  const all = await run(['tasks'], 'readonly', (tx) => req(tx.objectStore('tasks').getAll()));
  return includeDeleted ? all : all.filter((t) => !t.deleted);
}

export async function getTask(id) {
  return run(['tasks'], 'readonly', (tx) => req(tx.objectStore('tasks').get(id))).then((r) => r || null);
}

export async function saveTask(task) {
  const record = {
    id: task.id || newId(),
    name: task.name,
    code: task.code,
    client: task.client || '',
    summary: task.summary || '',
    favorite: Boolean(task.favorite),
    deleted: false,
    createdAt: task.createdAt || now(),
    updatedAt: now(),
  };
  await run(['tasks', 'meta'], 'readwrite', (tx) => {
    queue(tx, 'tasks', record.id, record.updatedAt);
    return req(tx.objectStore('tasks').put(record));
  });
  changed('tasks');
  return record;
}

export async function setTaskFavorite(id, favorite) {
  const task = await getTask(id);
  if (!task) return null;
  return saveTask({ ...task, favorite });
}

// Soft delete: the record stays (marked deleted) so sync can pass the
// deletion to other devices later. Past entries keep their own copies.
export async function deleteTask(id) {
  const task = await getTask(id);
  if (!task) return;
  const record = { ...task, deleted: true, updatedAt: now() };
  await run(['tasks', 'meta'], 'readwrite', (tx) => {
    queue(tx, 'tasks', record.id, record.updatedAt);
    return req(tx.objectStore('tasks').put(record));
  });
  changed('tasks');
}

// ---- Time entries

export async function listEntries() {
  const all = await run(['entries'], 'readonly', (tx) => req(tx.objectStore('entries').getAll()));
  return all.filter((e) => !e.deleted);
}

export async function listEntriesForDate(workDate) {
  const all = await run(['entries'], 'readonly', (tx) =>
    req(tx.objectStore('entries').index('workDate').getAll(IDBKeyRange.only(workDate))));
  return all.filter((e) => !e.deleted);
}

export async function getEntry(id) {
  return run(['entries'], 'readonly', (tx) => req(tx.objectStore('entries').get(id))).then((r) => r || null);
}

export async function getRunningEntry() {
  return (await listEntries()).find((e) => !e.end) || null;
}

// A record is unchanged if these still match what the plan was built from.
const sameVersion = (a, b) => a.updatedAt === b.updatedAt && a.start === b.start
  && a.end === b.end && Boolean(a.deleted) === Boolean(b.deleted);

export class StaleError extends Error {}

// Applies a plan (a list of { before, after } record changes) in one
// transaction. Every time change in the app comes through here, so two
// checks protect every save:
//   1. Nothing it touches changed since the plan was made (otherwise it
//      stops and asks to try again, instead of overwriting newer time).
//   2. Afterward, no minute counts twice and only one timer runs.
// Returns the records written and the reverse plan, for Undo.
export async function applyChanges(changes) {
  if (!changes.length) return { written: [], undo: [] };
  const stamp = now();
  const result = await run(['entries', 'meta'], 'readwrite', async (tx) => {
    const entries = tx.objectStore('entries');
    const all = await req(entries.getAll());
    const byId = new Map(all.map((e) => [e.id, e]));
    for (const c of changes) {
      const current = byId.get((c.after || c.before).id) || null;
      const ok = c.before ? current && sameVersion(current, c.before) : !current;
      if (!ok) throw new StaleError('Your time changed while this was open. Please try again.');
    }
    const written = changes.map((c) => ({ ...c.after, createdAt: c.after.createdAt || stamp, updatedAt: stamp }));
    for (const w of written) byId.set(w.id, w);
    const problem = timelineProblem([...byId.values()], new Set(written.map((w) => w.id)), Date.now());
    if (problem) throw new Error(`Not saved: ${problem}`);
    for (const w of written) {
      entries.put(w);
      queue(tx, 'entries', w.id, stamp);
    }
    const undo = changes.map((c, i) => ({
      before: written[i],
      after: c.before ? { ...c.before } : { ...written[i], deleted: true },
    }));
    return { written, undo };
  });
  changed('entries');
  return result;
}

// Undo: applies the reverse plan, with the same checks. If the time was
// used again since, it explains instead of double-counting.
export async function undoChanges(undo) {
  try {
    return await applyChanges(undo);
  } catch (error) {
    if (error instanceof StaleError) throw new Error('Can\u2019t undo: that time has changed since.');
    throw new Error(`Can\u2019t undo: ${error.message.replace(/^Not saved: /, '')}`);
  }
}

// ---- Backup

export async function exportAll() {
  const names = ['codebook', 'tasks', 'entries', 'portalMarks', 'meta'];
  const data = await run(names, 'readonly', (tx) => Promise.all(names.map((n) => req(tx.objectStore(n).getAll()))));
  const [codebook, tasks, entries, portalMarks, meta] = data;
  return {
    format: 'timeable-backup',
    formatVersion: 1,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    codebook: codebook[0] || null,
    tasks,
    entries,
    portalMarks,
    // Sync settings (including the GitHub token) never leave this device.
    meta: meta.filter((m) => !isPrivateMeta(m.key)),
  };
}

// Replaces everything on this device in one transaction: either all of the
// backup goes in, or nothing changes. If sync is on, it stays on: the
// device re-reads everything from the data repo on its next sync and sends
// the backup's records, so both devices end up with the newest of each.
export async function replaceAll(backup) {
  const names = ['codebook', 'tasks', 'entries', 'portalMarks', 'meta'];
  const stamp = now();
  await run(names, 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    const keep = (await req(meta.getAll())).filter((m) => PRIVATE_META.has(m.key));
    for (const n of names) tx.objectStore(n).clear();
    if (backup.codebook) tx.objectStore('codebook').put({ ...backup.codebook, id: 'current' });
    for (const t of backup.tasks) tx.objectStore('tasks').put(t);
    for (const e of backup.entries) tx.objectStore('entries').put(e);
    for (const m of backup.portalMarks) tx.objectStore('portalMarks').put(m);
    for (const m of backup.meta) if (!isPrivateMeta(m.key)) meta.put(m);
    for (const m of keep) meta.put(m.key === 'syncState' ? restartedState(m) : m);
    if (keep.some((m) => m.key === 'sync')) {
      if (backup.codebook) queue(tx, 'codebook', 'current', stamp);
      for (const t of backup.tasks) queue(tx, 'tasks', t.id, stamp);
      for (const e of backup.entries) queue(tx, 'entries', e.id, stamp);
      for (const m of backup.portalMarks) queue(tx, 'portalMarks', m.key, stamp);
    }
  });
  changed('all');
}

// ---- Sync settings and progress (this device only)
// "sync" holds the data repo's name, the token, the encryption key
// (cryptoKey: "key" is taken, it names the meta record), and this
// device's ID. "syncState" holds progress: which files have been read, the
// next file number, and when sync last finished.

const getMeta = (key) => run(['meta'], 'readonly', (tx) => req(tx.objectStore('meta').get(key))).then((r) => r || null);

export const getSyncConfig = () => getMeta('sync');
export const getSyncState = () => getMeta('syncState');

const freshState = () => ({ key: 'syncState', seq: 0, applied: {}, skipped: {}, snapshotSha: null, changesSha: null, configSha: null, lastSyncAt: null });

// Forget what's been read, so the next sync reads everything again. The file
// number keeps counting up, so this device never reuses a file name.
function restartedState(state) {
  return { ...freshState(), seq: state.seq || 0, lastSyncAt: state.lastSyncAt || null };
}

export async function saveSyncConfig(config, { restart = false } = {}) {
  await run(['meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    meta.put({ ...config, key: 'sync' });
    const state = await req(meta.get('syncState'));
    if (!state || restart) meta.put(state ? restartedState(state) : freshState());
  });
  changed('syncConfig');
}

// patch is an object to merge in, or a function from old state to new.
export async function updateSyncState(patch) {
  return run(['meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    const current = (await req(meta.get('syncState'))) || freshState();
    const next = { ...(typeof patch === 'function' ? patch(current) : { ...current, ...patch }), key: 'syncState' };
    meta.put(next);
    return next;
  });
}

// The next file number for this device's change files.
export async function nextSyncSeq() {
  return (await updateSyncState((s) => ({ ...s, seq: (s.seq || 0) + 1 }))).seq;
}

// Turns sync off on this device. With removeData, everything timeable keeps
// on this device is cleared too. The data repo isn't touched either way.
export async function clearSync({ removeData = false } = {}) {
  const names = removeData ? ['codebook', 'tasks', 'entries', 'portalMarks', 'meta'] : ['meta'];
  await run(names, 'readwrite', (tx) => {
    if (removeData) {
      for (const n of names) tx.objectStore(n).clear();
      return;
    }
    const meta = tx.objectStore('meta');
    meta.delete('sync');
    meta.delete('syncState');
    meta.delete(outboxRange());
  });
  changed(removeData ? 'all' : 'syncConfig');
}

// Every synced record, deleted ones included, so deletes reach other devices.
export async function allSyncedRecords() {
  const names = Object.keys(SYNCED_STORES);
  const lists = await run(names, 'readonly', (tx) => Promise.all(names.map((n) => req(tx.objectStore(n).getAll()))));
  return names.flatMap((n, i) => lists[i].map((record) => ({ store: n, record })));
}

// Queues every record to send, for the first sync from this device.
export async function queueEverything() {
  const names = Object.keys(SYNCED_STORES);
  const stamp = now();
  await run([...names, 'meta'], 'readwrite', async (tx) => {
    for (const n of names) {
      for (const r of await req(tx.objectStore(n).getAll())) queue(tx, n, r[SYNCED_STORES[n]], stamp);
    }
  });
}

// What's waiting to be sent, each with its record as it is now.
export async function getOutbox() {
  const names = Object.keys(SYNCED_STORES);
  return run([...names, 'meta'], 'readonly', async (tx) => {
    const notes = await req(tx.objectStore('meta').getAll(outboxRange()));
    const out = [];
    for (const note of notes) {
      if (!SYNCED_STORES[note.store]) continue;
      const record = await req(tx.objectStore(note.store).get(note.id));
      if (record) out.push({ note, store: note.store, record });
    }
    return out;
  });
}

export async function outboxCount() {
  return run(['meta'], 'readonly', (tx) => req(tx.objectStore('meta').count(outboxRange())));
}

// After a change file is safely on GitHub: clear the notes it covered,
// unless that record changed again meanwhile (then it goes in the next file).
export async function clearOutbox(notes) {
  await run(['meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    for (const n of notes) {
      const current = await req(meta.get(n.key));
      if (current && current.at === n.at) meta.delete(n.key);
    }
  });
}

// Record text with its fields in a fixed order, so two copies with the same
// content always compare equal.
function stableText(value) {
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableText(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Which copy of a record wins: the one changed most recently. If both were
// changed in the same millisecond, the larger text wins, so every device
// makes the same choice. Identical copies change nothing.
export function isNewer(incoming, local) {
  if (!local) return true;
  const a = incoming.updatedAt || '';
  const b = local.updatedAt || '';
  if (a !== b) return a > b;
  const ta = stableText(incoming);
  const tb = stableText(local);
  return ta !== tb && ta > tb;
}

// Applies records that came from another device, in one transaction. The
// newest copy of each record wins. These skip the overlap guard on purpose:
// refusing them would leave the two devices disagreeing for good. Any
// overlap that results is flagged on the Day screen and fixed with Adjust.
//
// resolve(entries) may return follow-up changes, such as ending a second
// running timer. Those are saved as this device's own changes (stamped now
// and queued to send). Returns { applied, fixes }.
export async function mergeRemote(items, { resolve } = {}) {
  const names = Object.keys(SYNCED_STORES);
  const stamp = now();
  const result = await run([...names, 'meta'], 'readwrite', async (tx) => {
    const meta = tx.objectStore('meta');
    const applied = [];
    for (const item of items) {
      const keyField = SYNCED_STORES[item && item.store];
      const record = item && item.record;
      if (!keyField || !record || typeof record !== 'object' || typeof record[keyField] !== 'string') continue;
      const os = tx.objectStore(item.store);
      const local = await req(os.get(record[keyField]));
      if (!isNewer(record, local)) continue;
      os.put(record);
      applied.push({ store: item.store, record, previous: local || null });
      // A newer copy from elsewhere replaces any unsent change here.
      meta.delete(outboxKey(item.store, record[keyField]));
    }
    const fixes = [];
    if (resolve && applied.some((a) => a.store === 'entries')) {
      const entries = (await req(tx.objectStore('entries').getAll())).filter((e) => !e.deleted);
      for (const fix of resolve(entries) || []) {
        const record = { ...fix.after, updatedAt: stamp };
        tx.objectStore('entries').put(record);
        queue(tx, 'entries', record.id, stamp);
        fixes.push({ ...fix, after: record });
      }
    }
    return { applied, fixes };
  });
  if (result.applied.length || result.fixes.length) changed('sync');
  return result;
}

export async function counts() {
  const names = ['tasks', 'entries'];
  const [tasks, entries] = await run(names, 'readonly', (tx) => Promise.all(names.map((n) => req(tx.objectStore(n).getAll()))));
  return {
    tasks: tasks.filter((t) => !t.deleted).length,
    entries: entries.filter((e) => !e.deleted).length,
  };
}

// ---- Storage protection
// Asks the browser not to clear timeable's data on its own. iOS decides
// whether to grant it; Home Screen apps are more likely to get it.

export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function isPersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return null;
  try {
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}
