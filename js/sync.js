// Sync between Josh's devices through his private data repo on GitHub.
//
// Each device's own store stays the source of truth. This module copies
// changes between devices:
// - Each device writes its own small sealed change files,
//   changes/<device>_<number>.bin. A file is never edited after it's
//   written, so devices never overwrite each other.
// - Once enough change files pile up, a device tidies: it writes everything
//   it has into one sealed summary file (snapshot.bin), then deletes the
//   change files that summary covers.
// - timeable-sync.json holds the passphrase salt and a check value. It isn't
//   secret; it only lets a device tell whether a passphrase is the right one.
//
// Everything sent is sealed by crypto.js first, and file names and commit
// messages never include record details. All sync code lives in this one
// file, so moving to another sync service later stays contained.

import * as store from './store.js';
import {
  checkMatches, cryptoSupported, DamagedFileError, deriveKey, fromBase64, KDF_ITERATIONS, makeCheck,
  newSalt, normalizePassphrase, sealJson, toBase64, unsealJson, WrongKeyError,
} from './crypto.js';
import { overlappingIds } from './timeline.js';

const API = 'https://api.github.com';
const API_VERSION = '2026-03-10';
const CONFIG_FILE = 'timeable-sync.json';
const SNAPSHOT_FILE = 'snapshot.bin';
const CHANGES_DIR = 'changes';
const COMMIT_MESSAGE = 'timeable sync';
const RECORDS_PER_FILE = 400;
const TIDY_AFTER = 30; // change files in the repo before one device tidies
const POLL_MS = 60 * 1000;
const AFTER_CHANGE_MS = 4000;
const WRITE_GAP_MS = 1000; // GitHub asks for a pause between writes
export const MIN_PASSPHRASE = 12;

// ---- Problems, in plain words

const MESSAGES = {
  offline: 'Offline. Changes will send when you’re back online.',
  auth: 'GitHub didn’t accept the token. It may have expired or been deleted. Paste a new one.',
  forbidden: 'The token can’t save to the data repo. Its Contents permission needs to be “Read and write.”',
  'not-found': 'Can’t find the data repo, or the token can’t reach it. Check the repo name and the token’s repository access.',
  'public-repo': 'That repo is public. Sync only works with a private repo, so nothing was sent.',
  'rate-limit': 'GitHub asked timeable to slow down. Sync will try again shortly.',
  server: 'GitHub isn’t responding right now. Sync will try again shortly.',
  'wrong-key': 'This device’s passphrase no longer matches the sync. If sync was set up again with a new passphrase, enter it here.',
  missing: 'The sync files are missing from the data repo. Turn sync off on this device, then set it up again.',
  'update-needed': 'Your other device has a newer version of timeable. Update this one: Settings → Check for updates.',
  damaged: 'A sync file in the data repo can’t be read. Everything on this device is safe. Turn sync off here, then set it up again.',
  unsupported: 'This browser can’t run sync. Update it, then try again.',
  conflict: 'GitHub was busy with another change. Sync will try again shortly.',
};

// Problems that need Josh. Automatic syncing pauses until he fixes them;
// the others clear up by themselves.
const NEEDS_ACTION = new Set(['auth', 'forbidden', 'not-found', 'public-repo', 'wrong-key', 'missing', 'update-needed', 'unsupported', 'damaged']);

export class SyncError extends Error {
  constructor(kind, detail, extra = {}) {
    super(MESSAGES[kind] || detail || 'Sync didn’t finish. It will try again shortly.');
    this.kind = kind;
    this.detail = detail || '';
    Object.assign(this, extra);
  }
}

// ---- GitHub, one request at a time

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const utf8 = (text) => new TextEncoder().encode(text);
let lastWrite = 0;

async function gh(config, method, path, { body, raw = false } = {}) {
  if (method !== 'GET') {
    const wait = lastWrite + WRITE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
  }
  let response;
  try {
    response = await fetch(`${API}/repos/${config.repo}${path ? `/${path}` : ''}`, {
      method,
      headers: {
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        Authorization: `Bearer ${config.token}`,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      // Reads check with GitHub every time. An unchanged answer comes back
      // as a 304, which doesn't count against GitHub's hourly limit.
      cache: method === 'GET' ? 'no-cache' : 'no-store',
    });
  } catch {
    throw new SyncError('offline');
  } finally {
    if (method !== 'GET') lastWrite = Date.now();
  }
  if (response.ok) {
    if (raw) return new Uint8Array(await response.arrayBuffer());
    return response.status === 204 ? null : response.json();
  }
  let message = '';
  try { message = (await response.json()).message || ''; } catch { /* no JSON body */ }
  const status = response.status;
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (status === 429 || (status === 403 && (remaining === '0' || /rate limit/i.test(message)))) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    const retryAt = retryAfter ? Date.now() + retryAfter * 1000 : reset ? reset * 1000 : Date.now() + 60 * 1000;
    throw new SyncError('rate-limit', message, { retryAt });
  }
  if (status === 401) throw new SyncError('auth', message);
  if (status === 403) throw new SyncError('forbidden', message);
  if (status === 404) throw new SyncError('not-found', message, { status });
  if (status === 409 || status === 422) throw new SyncError('conflict', message, { status });
  if (status >= 500) throw new SyncError('server', message);
  throw new SyncError('other', `GitHub answered ${status}${message ? `: ${message}` : ''}`);
}

// A folder's files. A missing folder (or an empty repo) is just empty.
async function listDir(config, path) {
  try {
    const data = await gh(config, 'GET', path ? `contents/${encodePath(path)}` : 'contents');
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.kind === 'not-found') return [];
    throw error;
  }
}

// Files are read by their content fingerprint (sha), which never changes,
// through the Git blobs endpoint (it handles files up to 100 MB).
const getBlob = (config, sha) => gh(config, 'GET', `git/blobs/${encodeURIComponent(sha)}`, { raw: true });

async function putFile(config, path, bytes, sha) {
  const data = await gh(config, 'PUT', `contents/${encodePath(path)}`, {
    body: { message: COMMIT_MESSAGE, content: toBase64(bytes), ...(sha ? { sha } : {}) },
  });
  return data.content.sha;
}

// New change files only. If GitHub is busy with another commit (409), try
// again. A 422 on a retry means the earlier try already saved it.
async function putNewFile(config, path, bytes) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await putFile(config, path, bytes);
    } catch (error) {
      if (error.kind !== 'conflict' || attempt >= 4) throw error;
      if (error.status === 422 && attempt > 1) return null;
      await sleep(1500 * attempt);
    }
  }
}

const deleteFile = (config, path, sha) =>
  gh(config, 'DELETE', `contents/${encodePath(path)}`, { body: { message: COMMIT_MESSAGE, sha } });

function parseConfigFile(bytes) {
  let info;
  try { info = JSON.parse(new TextDecoder().decode(bytes)); } catch { info = null; }
  const kdf = info && info.kdf;
  if (!info || info.format !== 'timeable-sync' || info.formatVersion !== 1 || !kdf || kdf.name !== 'PBKDF2'
    || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || typeof kdf.salt !== 'string' || typeof info.check !== 'string') {
    throw new SyncError('missing', 'timeable-sync.json isn’t in the expected format.');
  }
  return info;
}

// "owner/name", or a github.com link to the repo.
export function parseRepo(text) {
  const cleaned = String(text || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(cleaned) ? cleaned : null;
}

// Fine-grained tokens start with github_pat_. Classic tokens (ghp_) can
// reach every repo on the account, so they're refused.
export function tokenProblem(token) {
  const t = String(token || '').trim();
  if (!t) return 'Paste the token from GitHub.';
  if (/^gh[pousr]_/.test(t)) return 'That’s a classic token, which can reach every repo on the account. Make a fine-grained token limited to the data repo instead.';
  if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(t)) return 'That doesn’t look like a fine-grained GitHub token. Those start with github_pat_.';
  return null;
}

export function passphraseProblem(passphrase, again) {
  const p = normalizePassphrase(passphrase);
  if (p.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters. A few random words works well.`;
  if (again !== undefined && normalizePassphrase(again) !== p) return 'The two passphrases don’t match.';
  return null;
}

// ---- Merging rule for running timers (no storage here, so it can be tested)

// If more than one timer is running after a merge (one started on each
// device), the latest start keeps running. Each other one ends where the
// next session after it begins, the same as switching tasks on one device.
// A timer started in the very same minute as the one kept has no time of
// its own, so it's removed.
export function resolveRunning(entries) {
  const live = entries.filter((e) => !e.deleted && e.start);
  const running = live.filter((e) => !e.end).sort((a, b) =>
    Date.parse(b.start) - Date.parse(a.start) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  if (running.length < 2) return [];
  const [kept, ...others] = running;
  return others.map((entry) => {
    const startMs = Date.parse(entry.start);
    const later = live.filter((e) => e.id !== entry.id && Date.parse(e.start) > startMs).map((e) => Date.parse(e.start));
    const endMs = later.length ? Math.min(...later) : startMs;
    const after = endMs > startMs ? { ...entry, end: new Date(endMs).toISOString() } : { ...entry, deleted: true };
    return { before: entry, after, kept };
  });
}

// ---- Status, for Settings and the problem banner

let status = { state: 'off', repo: null, lastSyncAt: null, waiting: 0, problem: null };
const statusListeners = new Set();
const mergeListeners = new Set();

export const getStatus = () => status;

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

// Called after another device's changes arrive: { count, fixes, overlapDates }.
export function onMerged(fn) {
  mergeListeners.add(fn);
  return () => mergeListeners.delete(fn);
}

function setStatus(patch) {
  status = { ...status, ...patch };
  for (const fn of statusListeners) {
    try { fn(status); } catch (error) { console.error(error); }
  }
}

async function refreshStatus() {
  const [config, state, waiting] = await Promise.all([store.getSyncConfig(), store.getSyncState(), store.outboxCount()]);
  if (!config) {
    setStatus({ state: 'off', repo: null, lastSyncAt: null, waiting: 0, problem: null });
    return;
  }
  setStatus({
    state: status.state === 'off' ? 'idle' : status.state,
    repo: config.repo,
    lastSyncAt: state && state.lastSyncAt,
    waiting,
  });
}

// ---- One sync: check, pull, push, tidy

let repoChecked = false;
let retryAt = 0;

async function checkRepoIsPrivate(config) {
  let repo;
  try {
    repo = await gh(config, 'GET', '');
  } catch (error) {
    if (error.kind === 'not-found') throw new SyncError('not-found');
    throw error;
  }
  if (!repo || repo.private !== true) throw new SyncError('public-repo');
}

// Confirms this device's key still matches the repo's check value. It only
// re-reads the file when it has changed since the last check.
async function checkConfig(config, state, root) {
  const file = root.get(CONFIG_FILE);
  if (!file) throw new SyncError('missing');
  if (file.sha === state.configSha) return {};
  const info = parseConfigFile(await getBlob(config, file.sha));
  if (!(await checkMatches(config.cryptoKey, info.check))) throw new SyncError('wrong-key');
  return { configSha: file.sha };
}

async function openFile(config, sha, kind) {
  const data = await unsealJson(config.cryptoKey, await getBlob(config, sha));
  if (!data || data.format !== kind || data.formatVersion !== 1 || !Array.isArray(data.items)) throw new DamagedFileError();
  if (typeof data.schemaVersion === 'number' && data.schemaVersion > store.SCHEMA_VERSION) throw new SyncError('update-needed');
  return data;
}

async function pull(config, state, root) {
  const patch = {};
  const items = [];
  const applied = { ...(state.applied || {}) };
  const skipped = { ...(state.skipped || {}) };

  // The summary file, when another device has tidied since the last look.
  const snapshot = root.get(SNAPSHOT_FILE);
  if (snapshot && snapshot.sha !== state.snapshotSha) {
    let data;
    try {
      data = await openFile(config, snapshot.sha, 'timeable-snapshot');
    } catch (error) {
      if (error instanceof WrongKeyError || error instanceof DamagedFileError) throw new SyncError('damaged');
      throw error;
    }
    items.push(...data.items);
    for (const name of data.covers || []) applied[name] = true;
    patch.snapshotSha = snapshot.sha;
  }

  // Change files, re-listed only when the folder has changed.
  const dir = root.get(CHANGES_DIR);
  let files = state.changeFiles || {};
  if (!dir) files = {};
  else if (dir.sha !== state.changesSha) {
    files = {};
    for (const f of await listDir(config, CHANGES_DIR)) if (f.type === 'file') files[f.name] = f.sha;
  }
  patch.changesSha = dir ? dir.sha : null;
  const mine = `${config.deviceId}_`;
  let skippedNow = 0;
  for (const [name, sha] of Object.entries(files)) {
    if (name.startsWith(mine) || applied[name] || skipped[name]) continue;
    try {
      items.push(...(await openFile(config, sha, 'timeable-changes')).items);
      applied[name] = true;
    } catch (error) {
      // The key matched the repo's check value, so a file that won't open
      // was damaged. Skip it rather than stop syncing for good.
      if (!(error instanceof WrongKeyError || error instanceof DamagedFileError)) throw error;
      skipped[name] = true;
      skippedNow += 1;
    }
  }
  // Forget files that are gone (tidied into the summary file).
  for (const name of Object.keys(applied)) if (!(name in files)) delete applied[name];
  for (const name of Object.keys(skipped)) if (!(name in files)) delete skipped[name];
  Object.assign(patch, { applied, skipped, changeFiles: files });

  const result = items.length ? await store.mergeRemote(items, { resolve: resolveRunning }) : { applied: [], fixes: [] };
  return { patch, result, skippedNow };
}

async function push(config, files) {
  const outbox = await store.getOutbox();
  for (let i = 0; i < outbox.length; i += RECORDS_PER_FILE) {
    const chunk = outbox.slice(i, i + RECORDS_PER_FILE);
    const seq = await store.nextSyncSeq();
    const name = `${config.deviceId}_${String(seq).padStart(8, '0')}.bin`;
    const bytes = await sealJson(config.cryptoKey, {
      format: 'timeable-changes',
      formatVersion: 1,
      schemaVersion: store.SCHEMA_VERSION,
      device: config.deviceId,
      seq,
      createdAt: store.now(),
      items: chunk.map(({ store: s, record }) => ({ store: s, record })),
    });
    const sha = await putNewFile(config, `${CHANGES_DIR}/${name}`, bytes);
    await store.clearOutbox(chunk.map((c) => c.note));
    if (sha) files[name] = sha;
  }
}

// Folds the change files into one summary file once enough pile up. The
// summary is everything this device has, which already includes every file
// it has read or written, so only those files are removed. If another
// device tidies at the same moment, GitHub refuses one of the two summary
// saves (it names the version it replaces), and that device simply stops.
async function tidy(config, state, root, files) {
  const mine = `${config.deviceId}_`;
  const applied = state.applied || {};
  const covers = Object.keys(files).filter((n) => n.startsWith(mine) || applied[n]);
  if (Object.keys(files).length < TIDY_AFTER || !covers.length) return {};
  const bytes = await sealJson(config.cryptoKey, {
    format: 'timeable-snapshot',
    formatVersion: 1,
    schemaVersion: store.SCHEMA_VERSION,
    device: config.deviceId,
    createdAt: store.now(),
    covers,
    items: await store.allSyncedRecords(),
  });
  const current = root.get(SNAPSHOT_FILE);
  let sha;
  try {
    sha = await putFile(config, SNAPSHOT_FILE, bytes, current && current.sha);
  } catch (error) {
    if (error.kind === 'conflict') return {};
    throw error;
  }
  const remaining = { ...files };
  for (const name of covers) {
    try {
      await deleteFile(config, `${CHANGES_DIR}/${name}`, files[name]);
    } catch (error) {
      if (error.kind !== 'not-found' && error.kind !== 'conflict') throw error;
    }
    delete remaining[name];
  }
  return { snapshotSha: sha, changeFiles: remaining, changesSha: null };
}

async function runOnce() {
  const config = await store.getSyncConfig();
  if (!config) {
    await refreshStatus();
    return;
  }
  if (!cryptoSupported()) throw new SyncError('unsupported');
  setStatus({ state: 'syncing', repo: config.repo });
  if (!repoChecked) {
    await checkRepoIsPrivate(config);
    repoChecked = true;
  }
  let state = (await store.getSyncState()) || {};
  const root = new Map((await listDir(config, '')).map((e) => [e.name, e]));
  const configPatch = await checkConfig(config, state, root);
  state = await store.updateSyncState(configPatch);

  const pulled = await pull(config, state, root);
  state = await store.updateSyncState(pulled.patch);
  const files = { ...(state.changeFiles || {}) };
  await push(config, files);
  state = await store.updateSyncState({ changeFiles: files });
  state = await store.updateSyncState({ ...(await tidy(config, state, root, files)), lastSyncAt: store.now() });

  retryAt = 0;
  setStatus({
    state: 'ok',
    lastSyncAt: state.lastSyncAt,
    waiting: await store.outboxCount(),
    problem: pulled.skippedNow ? { kind: 'skipped', text: `${pulled.skippedNow} sync file${pulled.skippedNow === 1 ? '' : 's'} couldn’t be read and ${pulled.skippedNow === 1 ? 'was' : 'were'} skipped.`, needsAction: false } : null,
  });
  if (pulled.result.applied.length || pulled.result.fixes.length) await announce(pulled.result);
}

// Tells the screens what arrived: how many records, any timer that was
// ended, and the dates where time from both devices now overlaps.
async function announce(result) {
  const touched = new Set([
    ...result.applied.filter((a) => a.store === 'entries').map((a) => a.record.id),
    ...result.fixes.map((f) => f.after.id),
  ]);
  let overlapDates = [];
  if (touched.size) {
    const entries = await store.listEntries();
    const clash = overlappingIds(entries, Date.now());
    overlapDates = [...new Set(entries.filter((e) => clash.has(e.id) && touched.has(e.id)).map((e) => e.workDate))].sort();
  }
  const event = { count: result.applied.length, fixes: result.fixes, overlapDates };
  for (const fn of mergeListeners) {
    try { fn(event); } catch (error) { console.error(error); }
  }
}

async function runSafely() {
  try {
    await runOnce();
  } catch (error) {
    const kind = error instanceof SyncError ? error.kind
      : error instanceof WrongKeyError ? 'wrong-key'
        : error instanceof DamagedFileError ? 'damaged' : 'other';
    if (!(error instanceof SyncError)) console.error(error);
    if (kind === 'rate-limit') retryAt = error.retryAt || Date.now() + 60 * 1000;
    if (kind === 'not-found' || kind === 'public-repo') repoChecked = false;
    const text = error instanceof SyncError ? error.message : MESSAGES[kind] || 'Sync didn’t finish. It will try again shortly.';
    setStatus({
      state: kind === 'offline' ? 'offline' : 'error',
      waiting: await store.outboxCount().catch(() => status.waiting),
      problem: { kind, text, needsAction: NEEDS_ACTION.has(kind) },
    });
  }
}

// One sync at a time, across tabs too (Web Locks, where the browser has it).
function withLock(fn) {
  if (navigator.locks && navigator.locks.request) return navigator.locks.request('timeable-sync', fn);
  return fn();
}

let chain = Promise.resolve();
let queued = null;

// Runs a sync now, or right after the one in progress. Calls made while one
// is already waiting share it.
export function syncNow() {
  if (queued) return queued;
  queued = chain.then(() => {
    queued = null;
    return withLock(runSafely);
  });
  chain = queued.catch(() => {});
  return queued;
}

let changeTimer = null;

// Automatic syncs skip while a problem needs Josh, or while GitHub has asked
// for a pause. "Sync now" always tries.
function autoSync({ soon = false } = {}) {
  if (status.state === 'off') return;
  if (status.problem && status.problem.needsAction) return;
  if (Date.now() < retryAt) return;
  if (soon) {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => autoSync(), AFTER_CHANGE_MS);
    return;
  }
  syncNow();
}

let started = false;

// Sync runs when the app opens or comes back on screen, a few seconds after
// a change here, when the connection comes back, and about once a minute
// while the app is open.
export async function startSync() {
  if (started) return;
  started = true;
  store.onChange((what) => {
    if (what === 'sync') return; // changes that sync itself just brought in
    if (what === 'syncConfig') {
      refreshStatus().catch((error) => console.error(error));
      return;
    }
    store.outboxCount().then((waiting) => { if (status.state !== 'off') setStatus({ waiting }); }).catch(() => {});
    autoSync({ soon: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') autoSync();
  });
  window.addEventListener('online', () => autoSync());
  setInterval(() => { if (document.visibilityState === 'visible') autoSync(); }, POLL_MS);
  await refreshStatus();
  autoSync();
}

// ---- Setting up, changing, and turning off (used by Settings)

// Step 1: checks the repo name and token, and whether sync already exists
// there. Returns { repo, token, existing, info }.
export async function checkRepo(repoText, tokenText) {
  const repo = parseRepo(repoText);
  if (!repo) throw new SyncError('input', 'Enter the data repo as owner/name, for example your-name/timeable-data.');
  const problem = tokenProblem(tokenText);
  if (problem) throw new SyncError('input', problem);
  if (!cryptoSupported()) throw new SyncError('unsupported');
  const config = { repo, token: String(tokenText).trim() };
  await checkRepoIsPrivate(config);
  const root = await listDir(config, '');
  const file = root.find((e) => e.name === CONFIG_FILE);
  if (!file) return { ...config, existing: false };
  return { ...config, existing: true, info: parseConfigFile(await getBlob(config, file.sha)) };
}

async function keyFor(info, passphrase) {
  const key = await deriveKey(passphrase, fromBase64(info.kdf.salt), info.kdf.iterations);
  if (!(await checkMatches(key, info.check))) {
    throw new SyncError('input', 'That passphrase doesn’t match the one sync was set up with.');
  }
  return key;
}

async function saveAndStart(config, key) {
  await store.saveSyncConfig({
    repo: config.repo, token: config.token, cryptoKey: key, deviceId: store.newId(), setupAt: store.now(),
  }, { restart: true });
  // Everything here is new to the data repo, and everything there is new to
  // this device, so the first sync sends all and reads all.
  await store.queueEverything();
  repoChecked = false;
  retryAt = 0;
  setStatus({ state: 'idle', problem: null });
  await refreshStatus();
  return syncNow();
}

// Step 2: turns sync on with the passphrase. For a new sync, this saves the
// salt and check value to the repo first.
export async function turnOn(checked, passphrase) {
  if (checked.existing) return saveAndStart(checked, await keyFor(checked.info, passphrase));
  const problem = passphraseProblem(passphrase);
  if (problem) throw new SyncError('input', problem);
  const salt = newSalt();
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
  const info = {
    format: 'timeable-sync',
    formatVersion: 1,
    note: 'timeable sync settings. The salt and check value aren’t secret; everything else in this repo is encrypted.',
    createdAt: store.now(),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toBase64(salt) },
    check: await makeCheck(key),
  };
  try {
    await putFile(checked, CONFIG_FILE, utf8(`${JSON.stringify(info, null, 2)}\n`));
  } catch (error) {
    if (error.kind === 'conflict') throw new SyncError('input', 'Sync was just set up from another device. Close this and try again.');
    throw error;
  }
  return saveAndStart(checked, key);
}

// Forgot the passphrase: removes timeable's files from the data repo so sync
// can be set up again with a new one. Each device keeps its own data.
export async function startOver(checked) {
  const config = { repo: checked.repo, token: checked.token };
  for (const f of await listDir(config, CHANGES_DIR)) if (f.type === 'file') await deleteFile(config, `${CHANGES_DIR}/${f.name}`, f.sha);
  for (const f of await listDir(config, '')) {
    if (f.type === 'file' && (f.name === CONFIG_FILE || f.name === SNAPSHOT_FILE)) await deleteFile(config, f.name, f.sha);
  }
  return { ...config, existing: false };
}

// A new token, for when the old one expired or was replaced.
export async function updateToken(tokenText) {
  const problem = tokenProblem(tokenText);
  if (problem) throw new SyncError('input', problem);
  const config = await store.getSyncConfig();
  if (!config) throw new SyncError('input', 'Sync isn’t set up on this device.');
  const next = { ...config, token: String(tokenText).trim() };
  await checkRepoIsPrivate(next);
  await store.saveSyncConfig(next);
  repoChecked = true;
  setStatus({ problem: null });
  return syncNow();
}

// The passphrase changed on the other device (sync was set up again).
export async function updatePassphrase(passphrase) {
  const config = await store.getSyncConfig();
  if (!config) throw new SyncError('input', 'Sync isn’t set up on this device.');
  const root = await listDir(config, '');
  const file = root.find((e) => e.name === CONFIG_FILE);
  if (!file) throw new SyncError('missing');
  const key = await keyFor(parseConfigFile(await getBlob(config, file.sha)), passphrase);
  await store.saveSyncConfig({ ...config, cryptoKey: key }, { restart: true });
  await store.queueEverything();
  setStatus({ problem: null });
  return syncNow();
}

export async function turnOff({ removeData = false } = {}) {
  await store.clearSync({ removeData });
  repoChecked = false;
  retryAt = 0;
  setStatus({ state: 'off', repo: null, lastSyncAt: null, waiting: 0, problem: null });
}
