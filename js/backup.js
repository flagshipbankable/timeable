// Backup files: checking one before import, and handing one to the user.

import { SCHEMA_VERSION } from './store.js';

export const BACKUP_FORMAT = 'timeable-backup';

// Checks a parsed backup file. Returns { ok, errors, backup, summary }.
export function validateBackupFile(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['This file isn’t a timeable backup.'] };
  }
  if (data.format !== BACKUP_FORMAT) {
    const hint = data.format === 'timeable-codebook' ? ' It’s a code book. Use Load code book instead.' : '';
    return { ok: false, errors: [`This file isn’t a timeable backup.${hint}`] };
  }
  const errors = [];
  if (data.formatVersion !== 1) errors.push(`This backup uses format version ${data.formatVersion}, which this version of timeable doesn’t know. Update the app and try again.`);
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    errors.push('This backup came from a newer version of timeable. Update the app first, then import it.');
  }
  for (const key of ['tasks', 'entries', 'portalMarks', 'meta']) {
    if (!Array.isArray(data[key])) errors.push(`The backup is missing its ${key === 'portalMarks' ? 'portal checkmarks' : key} section.`);
  }
  if (data.codebook !== null && (typeof data.codebook !== 'object' || !Array.isArray(data.codebook.codes))) {
    errors.push('The backup’s code book section isn’t readable.');
  }
  const badId = (list) => list.some((r) => !r || typeof r !== 'object' || typeof (r.id ?? r.key) !== 'string');
  if (Array.isArray(data.tasks) && badId(data.tasks)) errors.push('Some tasks in the backup are damaged.');
  if (Array.isArray(data.entries) && badId(data.entries)) errors.push('Some entries in the backup are damaged.');
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    backup: data,
    summary: {
      exportedAt: data.exportedAt || '',
      codes: data.codebook ? data.codebook.codes.filter((c) => c.active !== false).length : 0,
      tasks: data.tasks.filter((t) => !t.deleted).length,
      entries: data.entries.filter((e) => !e.deleted).length,
    },
  };
}

export function backupFileName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `timeable-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

// On iPhone this opens the Share sheet (where "Save to Files" lives).
// Elsewhere it downloads the file. Returns 'shared', 'downloaded', or
// 'cancelled'.
export async function deliverFile(name, text) {
  const file = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
      // Sharing failed for another reason: fall back to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

// Reads a file the user picked and parses it as JSON.
export async function readJsonFile(file) {
  const text = await file.text();
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, errors: ['That file couldn’t be read. Make sure it’s the .json file timeable made.'] };
  }
}
