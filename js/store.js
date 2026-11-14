// The only file that reads and writes saved data. Everything lives in
// IndexedDB on this device. Records are sync-ready: random IDs, updatedAt
// times, and a deleted flag instead of real deletes.

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

// ---- Code book (one record, id "current")

export async function getCodebook() {
  return run(['codebook'], 'readonly', (tx) => req(tx.objectStore('codebook').get('current'))).then((r) => r || null);
}

export async function saveCodebook(codebook) {
  const record = { ...codebook, id: 'current', updatedAt: now() };
  await run(['codebook'], 'readwrite', (tx) => req(tx.objectStore('codebook').put(record)));
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
  await run(['tasks'], 'readwrite', (tx) => req(tx.objectStore('tasks').put(record)));
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
  await run(['tasks'], 'readwrite', (tx) => req(tx.objectStore('tasks').put(record)));
  changed('tasks');
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
    meta,
  };
}

// Replaces everything on this device in one transaction: either all of the
// backup goes in, or nothing changes.
export async function replaceAll(backup) {
  const names = ['codebook', 'tasks', 'entries', 'portalMarks', 'meta'];
  await run(names, 'readwrite', (tx) => {
    for (const n of names) tx.objectStore(n).clear();
    if (backup.codebook) tx.objectStore('codebook').put({ ...backup.codebook, id: 'current' });
    for (const t of backup.tasks) tx.objectStore('tasks').put(t);
    for (const e of backup.entries) tx.objectStore('entries').put(e);
    for (const m of backup.portalMarks) tx.objectStore('portalMarks').put(m);
    for (const m of backup.meta) tx.objectStore('meta').put(m);
  });
  changed('all');
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
