import { icons } from '../icons.js';
import { emptyState, heading } from '../ui.js';

export function render(el) {
  el.innerHTML = heading('Desk', 'Tap a task to clock in.') + emptyState(
    icons.desk(26),
    'Your desk is ready',
    'Once your code book and tasks are set up, they will appear here so you can clock in with one tap.',
  );
}
