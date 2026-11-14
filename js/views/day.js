import { icons } from '../icons.js';
import { emptyState, heading } from '../ui.js';

export function render(el) {
  el.innerHTML = heading('Day', 'Ready for the portal') + emptyState(
    icons.day(26),
    'No time logged today',
    'Each day will show here as portal lines: client, service code, and hours rounded to the nearest quarter hour, with copy buttons and an "entered" checkmark.',
  );
}
