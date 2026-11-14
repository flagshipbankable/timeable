import { icons } from '../icons.js';
import { emptyState, heading } from '../ui.js';

export function render(el) {
  el.innerHTML = heading('Tasks', 'Named to match your portal templates') + emptyState(
    icons.tasks(26),
    'No tasks yet',
    'Load your code book in Settings first, then add tasks with the same names as your portal templates.',
  );
}
