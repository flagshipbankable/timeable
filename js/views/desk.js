import { icons } from '../icons.js';
import { emptyState, esc, heading, plural } from '../ui.js';
import * as store from '../store.js';
import { sortTasks } from './tasks.js';

export async function render(el) {
  const [codebook, tasks] = await Promise.all([store.getCodebook(), store.listTasks()]);

  if (!codebook || tasks.length === 0) {
    el.innerHTML = heading('Desk', 'Tap a task to clock in.') + `
      <section class="card">
        <h2>Get set up</h2>
        <ol class="setup">
          <li class="${codebook ? 'done' : ''}"><a href="#settings">Load your code book</a> in Settings${codebook ? ' ✓' : ''}</li>
          <li><a href="#tasks">Add your tasks</a>, named like your portal templates</li>
        </ol>
        <p class="muted small">The timer arrives in the next update.</p>
      </section>`;
    return;
  }

  const sorted = sortTasks(tasks);
  el.innerHTML = heading('Desk', 'Tap a task to clock in.') + emptyState(
    icons.desk(26),
    `${plural(tasks.length, 'task')} ready`,
    'The timer arrives in the next update. Your tasks will be here, favorites first, ready to clock in with one tap.',
  ) + `<ul class="chip-list" aria-label="Your tasks">${sorted.map((t) =>
    `<li class="chip">${t.favorite ? icons.starFilled(14) : ''}${esc(t.name)}</li>`).join('')}</ul>`;
}
