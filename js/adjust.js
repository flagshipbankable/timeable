// Saving time safely. Every new or changed session comes through saveTime:
// it checks the new time against everything already logged, and when it
// would share minutes with other sessions, it asks how to adjust (a minute
// can only count for one task). Also builds the plain-language previews
// shown while you type.

import { esc } from './ui.js';
import { openSheet } from './sheet.js';
import * as store from './store.js';
import {
  MINUTE, autoPlan, floorMinute, needsChoice, overlapsWith, planChange, spanOf,
} from './timeline.js';
import { formatMinutes, formatRange, formatTime } from './time.js';

const rangeOf = (span) => formatRange(span.s, span.e);
const lengthOf = (span, nowMs) => (span.e === null ? nowMs : span.e) - span.s;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One sentence per change a plan makes to other time.
export function effectText(effect, nowMs) {
  const name = effect.entry.taskName;
  const from = effect.from;
  switch (effect.type) {
    case 'end':
      return `${name} (running since ${formatTime(from.s)}) ends at ${formatTime(effect.to.e)}.`;
    case 'trim': {
      const less = lengthOf(from, nowMs) - lengthOf(effect.to, nowMs);
      return `${name}: ${rangeOf(from)} becomes ${rangeOf(effect.to)}${less > 0 ? ` (${formatMinutes(less)} less)` : ''}.`;
    }
    case 'split': {
      const [a, b] = effect.pieces;
      const less = lengthOf(from, nowMs) - lengthOf(a, nowMs) - lengthOf(b, nowMs);
      return `${name} (${rangeOf(from)}) splits into ${rangeOf(a)} and ${rangeOf(b)} (${formatMinutes(less)} less).`;
    }
    case 'remove': {
      const length = lengthOf(from, nowMs);
      if (from.e === null) return `${name} (running since ${formatTime(from.s)}) is replaced${length < MINUTE ? '; it was under a minute' : ''}.`;
      return `${name} ${rangeOf(from)} is removed (${formatMinutes(length)}).`;
    }
    case 'moved':
      return `${name} starts at ${formatTime(effect.to.s)} instead of ${formatTime(from.s)}.`;
    case 'fit': {
      const total = effect.pieces.reduce((sum, p) => sum + (p.e - p.s), 0);
      const wanted = from.e - from.s;
      const where = effect.pieces.map(rangeOf).join(' and ');
      return effect.pieces.length === 1
        ? `${name} becomes ${where} (${formatMinutes(total)} instead of ${formatMinutes(wanted)}).`
        : `${name} fills the free time: ${where} (${formatMinutes(total)} instead of ${formatMinutes(wanted)}).`;
    }
    default:
      return '';
  }
}

// What saving would do, in words, while the form is still open.
// Returns null, { tone: 'info', text } for automatic changes, or
// { tone: 'warn', text } when saving will ask how to adjust.
export function previewText(proposed, entries, nowMs, verb = 'save') {
  const overlaps = overlapsWith(proposed, entries, nowMs);
  if (!overlaps.length) return null;
  if (!needsChoice(proposed, entries, nowMs)) {
    const plan = autoPlan(proposed, entries, nowMs, () => 'preview');
    return { tone: 'info', text: plan.effects.map((e) => effectText(e, nowMs)).join(' ') };
  }
  const list = overlaps.slice(0, 3).map((o) => `${o.taskName} ${rangeOf(spanText(o, nowMs))}`).join(', ');
  const more = overlaps.length > 3 ? ` and ${overlaps.length - 3} more` : '';
  return { tone: 'warn', text: `Overlaps ${list}${more}. When you ${verb}, you’ll choose how to adjust.` };
}

const spanText = (entry, nowMs) => {
  const s = spanOf(entry, nowMs);
  return { s: s.s, e: s.running ? null : s.e };
};

// ---- The timeline picture

// Draws sessions as blocks on a track. rows: [[{ s, e, label, kind }]].
function timelineHtml(rows, win, nowMs) {
  const width = win.e - win.s;
  const pct = (ms) => ((Math.min(Math.max(ms, win.s), win.e) - win.s) / width) * 100;
  const lane = (blocks) => `<div class="tl-lane">${blocks.map((b) => {
    const left = pct(b.s);
    const w = Math.max(pct(b.e === null ? nowMs : b.e) - left, 0.8);
    return `<span class="tl-block tl-${b.kind}" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%">${w > 22 ? `<span>${esc(b.label)}</span>` : ''}</span>`;
  }).join('')}</div>`;
  const endLabel = win.last >= floorMinute(nowMs) ? 'now' : formatTime(win.last);
  return `<div class="tl" aria-hidden="true">${rows.map(lane).join('')}
    <div class="tl-scale"><span>${formatTime(win.first)}</span><span>${endLabel}</span></div></div>`;
}

function windowFor(proposed, involved, nowMs) {
  const spans = [spanOf(proposed, nowMs), ...involved.map((e) => spanOf(e, nowMs))];
  const s = Math.min(...spans.map((x) => x.s));
  const e = Math.max(...spans.map((x) => x.e));
  const pad = Math.max((e - s) * 0.04, MINUTE);
  return { s: s - pad, e: Math.min(e + pad, Math.max(e, nowMs)), first: s, last: e };
}

// The result of a plan, as blocks on one track.
function afterBlocks(plan, proposed, involved, nowMs) {
  const byId = new Map(involved.map((e) => [e.id, e]));
  for (const c of plan.changes) byId.set(c.after.id, c.after);
  return [...byId.values()].filter((e) => !e.deleted).map((e) => {
    const sp = spanOf(e, nowMs);
    return { s: sp.s, e: sp.running ? null : sp.e, label: e.taskName, kind: plan.proposedIds.includes(e.id) ? 'new' : 'other' };
  });
}

// ---- The question

function optionText(policy, plan, proposed, nowMs) {
  const name = proposed.taskName;
  const P = spanOf(proposed, nowMs);
  if (policy === 'adjust') {
    return {
      title: P.running ? `Start ${name} at ${formatTime(P.s)}` : `Keep ${name} at ${formatRange(P.s, P.e)}`,
      sub: 'Change the other time to make room.',
    };
  }
  if (plan.impossible) {
    return { title: `Fit ${name} around the other time`, sub: `Not possible: ${formatRange(P.s, P.e)} is already fully logged.` };
  }
  if (P.running) {
    const start = plan.proposed[0].s;
    return {
      title: start >= floorMinute(nowMs) ? `Start ${name} now (${formatTime(start)})` : `Start ${name} at ${formatTime(start)} instead`,
      sub: 'Leave the other time as it is.',
    };
  }
  return {
    title: plan.proposed.length === 1 ? `Shorten ${name} to ${rangeOf(plan.proposed[0])}` : `Fit ${name} into the free time`,
    sub: 'Leave the other time as it is.',
  };
}

// Opens the "Adjust overlapping time" sheet. Resolves with the chosen plan,
// or null if the person goes back to change the times themselves.
export function chooseAdjustment(proposed, entries, nowMs) {
  const involved = overlapsWith(proposed, entries, nowMs);
  const plans = {
    adjust: planChange(proposed, entries, nowMs, 'adjust', store.newId),
    fit: planChange(proposed, entries, nowMs, 'fit', store.newId),
  };
  const win = windowFor(proposed, involved, nowMs);
  const P = spanOf(proposed, nowMs);
  const name = proposed.taskName;
  const what = P.running ? `Starting ${name} at ${formatTime(P.s)}` : `${name} ${formatRange(P.s, P.e)}`;
  const list = involved.map((o) => `<strong>${esc(o.taskName)}</strong> ${esc(rangeOf(spanText(o, nowMs)))}`).join(', ');
  const before = timelineHtml([
    involved.map((o) => ({ ...spanText(o, nowMs), label: o.taskName, kind: 'other' })),
    [{ s: P.s, e: P.running ? null : P.e, label: name, kind: 'proposed' }],
  ], win, nowMs);

  const card = (policy) => {
    const plan = plans[policy];
    const text = optionText(policy, plan, proposed, nowMs);
    const effects = plan.effects.filter((e) => policy === 'fit' || e.type !== 'fit');
    const disabled = Boolean(plan.impossible);
    return `<label class="choice${disabled ? ' is-disabled' : ''}">
        <input type="radio" name="choice" value="${policy}" ${policy === 'adjust' ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="choice-body">
          <span class="choice-title">${esc(text.title)}</span>
          <span class="choice-sub">${esc(text.sub)}</span>
          ${disabled ? '' : timelineHtml([afterBlocks(plan, proposed, involved, nowMs)], win, nowMs)}
          ${effects.length ? `<span class="choice-effects">${effects.map((e) => `<span>${esc(effectText(e, nowMs))}</span>`).join('')}</span>` : ''}
        </span>
      </label>`;
  };

  return new Promise((resolve) => {
    let chosen = null;
    openSheet({
      title: 'Adjust overlapping time',
      bodyHtml: `<form class="adjust" id="adjust-form" novalidate>
          <p class="adjust-lead">${esc(what)} overlaps ${list}. A minute can only count for one task, so choose how to fix it.</p>
          <div class="adjust-before"><p class="tl-caption">Right now</p>${before}
            <p class="tl-key"><span><span class="key key-other"></span>Already logged</span><span><span class="key key-proposed"></span>${esc(name)} (new)</span></p></div>
          <fieldset class="choices"><legend class="sr-only">How to adjust</legend>${card('adjust')}${card('fit')}</fieldset>
          <div class="button-row">
            <button class="button" type="submit">Apply</button>
            <button class="button button-soft" type="button" data-back>Go back</button>
          </div>
        </form>`,
      onMount(sheet, close) {
        const form = sheet.querySelector('#adjust-form');
        sheet.querySelector('[data-back]').addEventListener('click', close);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const choice = form.querySelector('input[name="choice"]:checked');
          chosen = plans[choice.value];
          close();
        });
      },
      onClose: () => resolve(chosen),
    });
  });
}

// Saves a new or changed session. Asks first if other time has to change.
// Returns { plan, result } once saved, or null if the person went back.
export async function saveTime(proposed) {
  const entries = await store.listEntries();
  const nowMs = Date.now();
  const asked = needsChoice(proposed, entries, nowMs);
  const plan = asked ? await chooseAdjustment(proposed, entries, nowMs) : autoPlan(proposed, entries, nowMs, store.newId);
  if (!plan) return null;
  const result = await store.applyChanges(plan.changes);
  return { plan, result, asked, nowMs };
}

// A short summary of what changed to other time, for the toast.
export function adjustedSummary(plan) {
  const others = plan.effects.filter((e) => ['trim', 'split', 'remove'].includes(e.type));
  if (!others.length) return '';
  if (others.length === 1) {
    const e = others[0];
    const verb = { trim: 'shortened', split: 'split', remove: 'removed' }[e.type];
    return ` ${e.entry.taskName} was ${verb}.`;
  }
  return ` ${plural(others.length, 'other session')} adjusted.`;
}

