// The time rule: no minute counts for two sessions. This file finds where a
// change would break that rule and builds plans to fix it. It's pure logic
// (no screens, no storage), so every case can be tested on its own.
//
// A plan is a list of record changes, { before, after }. before is null for
// a new record; after.deleted is true for a removed one. The store applies a
// plan in one step and keeps the reverse plan for Undo.
//
// Times are whole minutes, matching what the screens show, so a session
// shown as 9:00–9:25 really is 25 minutes.

import { localDate } from './time.js';

export const MINUTE = 60000;
export const floorMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

const iso = (ms) => new Date(ms).toISOString();
const live = (e) => e && !e.deleted;

// A session's time as numbers. A running session runs up to now.
export function spanOf(entry, nowMs) {
  const s = Date.parse(entry.start);
  const e = entry.end ? Date.parse(entry.end) : Math.max(s, nowMs);
  return { s, e, running: !entry.end };
}

export function overlapMs(a, b) {
  return Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s));
}

// Sessions (other than this one) that share minutes with it.
export function overlapsWith(entry, entries, nowMs) {
  const p = spanOf(entry, nowMs);
  return entries
    .filter((o) => live(o) && o.id !== entry.id && overlapMs(spanOf(o, nowMs), p) > 0)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

// Ids of saved sessions that already overlap each other (for example from an
// imported backup), so the Day screen can flag them.
export function overlappingIds(entries, nowMs) {
  const list = entries.filter(live).map((e) => ({ id: e.id, ...spanOf(e, nowMs) })).sort((a, b) => a.s - b.s);
  const ids = new Set();
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length && list[j].s < list[i].e; j += 1) {
      if (overlapMs(list[i], list[j]) > 0) { ids.add(list[i].id); ids.add(list[j].id); }
    }
  }
  return ids;
}

// Checks a set of records after a change: returns a plain-language problem,
// or null. Only records that changed are checked, so an old overlap
// elsewhere doesn't block unrelated edits (the Day screen flags those).
export function timelineProblem(entries, changedIds, nowMs) {
  const current = entries.filter(live);
  const running = current.filter((e) => !e.end);
  if (running.length > 1 && running.some((e) => changedIds.has(e.id))) return 'Two timers would run at once.';
  for (const c of current) {
    if (!changedIds.has(c.id)) continue;
    const span = spanOf(c, nowMs);
    if (c.end && span.e <= span.s) return `${c.taskName} would end before it starts.`;
    for (const o of current) {
      if (o.id !== c.id && overlapMs(span, spanOf(o, nowMs)) > 0) {
        return `${c.taskName} and ${o.taskName} would count the same minutes twice.`;
      }
    }
  }
  return null;
}

// ---- Building plans

function retime(entry, s, e) {
  return { ...entry, start: iso(s), end: e === null ? null : iso(e), workDate: localDate(new Date(s)) };
}

// The second piece of a split session: same task, client, and notes, but
// travel, prep, miles, destination, and expenses stay on the first piece so
// they're never counted twice.
function secondPiece(entry, s, e, makeId) {
  const { createdAt, updatedAt, ...rest } = entry;
  return {
    ...retime(rest, s, e), id: makeId(), deleted: false,
    travelHours: 0, prepHours: 0, miles: 0, destination: '', expenses: 0,
  };
}

// A finished piece shorter than a minute isn't worth keeping.
const tooShort = (s, e) => e !== null && e - s < MINUTE;

class PlanBuilder {
  constructor(entries, makeId) {
    this.byId = new Map(entries.map((e) => [e.id, e]));
    this.changes = new Map();
    this.effects = [];
    this.makeId = makeId;
  }

  update(before, after) {
    const prior = this.changes.get(after.id);
    this.changes.set(after.id, { before: prior ? prior.before : before, after });
  }

  create(after) {
    this.changes.set(after.id, { before: null, after });
  }

  remove(entry) {
    this.update(entry, { ...entry, deleted: true });
  }

  list() {
    return [...this.changes.values()];
  }
}

// Makes room for proposed time by changing the other sessions:
// trims, splits, ends, or removes them.
function makeRoom(b, proposedSpan, others, nowMs) {
  const P = proposedSpan;
  for (const o of others) {
    const O = spanOf(o, nowMs);
    if (overlapMs(O, P) <= 0) continue;
    const from = { s: O.s, e: O.running ? null : O.e };
    if (P.s <= O.s && P.e >= O.e) {
      b.remove(o);
      b.effects.push({ type: 'remove', entry: o, from });
    } else if (O.s < P.s && O.e > P.e) {
      if (O.running && P.running) {
        // Clocking in while another timer runs: that one ends here.
        b.update(o, retime(o, O.s, P.s));
        b.effects.push({ type: 'end', entry: o, from, to: { s: O.s, e: P.s } });
        continue;
      }
      const firstShort = tooShort(O.s, P.s);
      const secondEnd = O.running ? null : O.e;
      const secondShort = tooShort(P.e, secondEnd);
      const pieces = [];
      if (firstShort) b.remove(o);
      else { b.update(o, retime(o, O.s, P.s)); pieces.push({ s: O.s, e: P.s }); }
      if (!secondShort) {
        const second = secondPiece(o, P.e, secondEnd, b.makeId);
        b.create(second);
        pieces.push({ s: P.e, e: secondEnd });
      }
      b.effects.push(pieces.length === 2
        ? { type: 'split', entry: o, from, pieces }
        : pieces.length === 1 ? { type: 'trim', entry: o, from, to: pieces[0] } : { type: 'remove', entry: o, from });
    } else if (O.s < P.s) {
      // Starts before the proposed time and runs into it: ends earlier.
      if (tooShort(O.s, P.s)) { b.remove(o); b.effects.push({ type: 'remove', entry: o, from }); continue; }
      b.update(o, retime(o, O.s, P.s));
      b.effects.push({ type: O.running ? 'end' : 'trim', entry: o, from, to: { s: O.s, e: P.s } });
    } else {
      // Starts inside the proposed time and runs past it: starts later.
      const end = O.running ? null : O.e;
      if (tooShort(P.e, end)) { b.remove(o); b.effects.push({ type: 'remove', entry: o, from }); continue; }
      b.update(o, retime(o, P.e, end));
      b.effects.push({ type: 'trim', entry: o, from, to: { s: P.e, e: end } });
    }
  }
}

// Free stretches inside [s, e) that no other session uses.
export function freeTime(s, e, others, nowMs) {
  const busy = others.map((o) => spanOf(o, nowMs)).filter((o) => o.e > s && o.s < e).sort((a, b) => a.s - b.s);
  const gaps = [];
  let cursor = s;
  for (const o of busy) {
    if (o.s > cursor) gaps.push({ s: cursor, e: Math.min(o.s, e) });
    cursor = Math.max(cursor, o.e);
    if (cursor >= e) break;
  }
  if (cursor < e) gaps.push({ s: cursor, e });
  return gaps.filter((g) => g.e - g.s >= MINUTE);
}

// Does saving this need the person to choose how to adjust? Ending the
// running timer when clocking in is expected, so it doesn't; anything that
// would trim, split, or remove other time does.
export function needsChoice(proposed, entries, nowMs) {
  const P = spanOf(proposed, nowMs);
  return overlapsWith(proposed, entries, nowMs).some((o) => {
    const O = spanOf(o, nowMs);
    if (P.running && O.running) return O.s < P.s ? false : O.s !== P.s;
    return true;
  });
}

// Builds a plan. policy:
//   'adjust' — the proposed time stays; other sessions make room.
//   'fit'    — other sessions stay; the proposed time fits around them.
// Returns { changes, effects, proposed: [pieces], impossible }.
export function planChange(proposed, entries, nowMs, policy, makeId) {
  // In time order, so the changes read in the order they happen.
  const others = entries.filter((e) => live(e) && e.id !== proposed.id).sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
  const b = new PlanBuilder(entries, makeId);
  const original = proposed.id ? entries.find((e) => e.id === proposed.id) || null : null;
  const base = { ...proposed, id: proposed.id || makeId(), deleted: false };
  const save = (record) => (original ? b.update(original, record) : b.create(record));
  let P = spanOf(base, nowMs);

  if (policy === 'adjust') {
    makeRoom(b, P, others, nowMs);
    save(base);
    return { policy, changes: b.list(), effects: b.effects, proposed: [{ s: P.s, e: base.end ? P.e : null }], proposedIds: [base.id], impossible: null };
  }

  // 'fit'
  if (P.running) {
    // A running session can't fill gaps (it has one start), so it starts
    // after the latest session it would overlap. If that's the timer that's
    // running now, it starts now and that timer ends now.
    const finishedEnds = others.filter((o) => o.end && overlapMs(spanOf(o, nowMs), P) > 0).map((o) => spanOf(o, nowMs).e);
    const runningOther = others.find((o) => !o.end);
    let start = Math.max(P.s, ...finishedEnds);
    if (runningOther && Date.parse(runningOther.start) >= start && runningOther.id !== base.id) {
      start = Math.max(start, floorMinute(nowMs));
    }
    const moved = retime(base, start, null);
    P = spanOf(moved, nowMs);
    makeRoom(b, P, others, nowMs); // only ends the running timer here
    save(moved);
    if (start !== Date.parse(base.start)) {
      b.effects.unshift({ type: 'moved', entry: moved, from: { s: Date.parse(base.start), e: null }, to: { s: start, e: null } });
    }
    return { policy, changes: b.list(), effects: b.effects, proposed: [{ s: start, e: null }], proposedIds: [moved.id], impossible: null };
  }

  const gaps = freeTime(P.s, P.e, others, nowMs);
  if (!gaps.length) {
    return { policy, changes: [], effects: [], proposed: [], impossible: 'There’s no free time in that range.' };
  }
  const pieces = gaps.map((g, i) => (i === 0
    ? retime(base, g.s, g.e)
    : secondPiece(base, g.s, g.e, makeId)));
  save(pieces[0]);
  pieces.slice(1).forEach((piece) => b.create(piece));
  b.effects.unshift({ type: 'fit', entry: base, from: { s: P.s, e: P.e }, pieces: gaps });
  return { policy, changes: b.list(), effects: b.effects, proposed: gaps, proposedIds: pieces.map((x) => x.id), impossible: null };
}

// The plan used when no choice is needed (or the only option).
export function autoPlan(proposed, entries, nowMs, makeId) {
  return planChange(proposed, entries, nowMs, 'adjust', makeId);
}

// Finishing the running session. Under a minute isn't kept.
export function planFinish(running, endMs) {
  const s = Date.parse(running.start);
  if (endMs - s < MINUTE) {
    return { changes: [{ before: running, after: { ...running, deleted: true } }], tooShort: true };
  }
  return { changes: [{ before: running, after: { ...running, end: iso(endMs) } }], tooShort: false };
}

export function planDelete(entry) {
  return { changes: [{ before: entry, after: { ...entry, deleted: true } }] };
}

// Minutes a plan adds (+) or takes away (−) from each existing session.
export function minutesOf(span) {
  return Math.round((span.e - span.s) / MINUTE);
}
