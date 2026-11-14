import { icons } from '../icons.js';
import { emptyState, heading } from '../ui.js';

export function render(el) {
  el.innerHTML = heading('Week', 'Monday through Sunday') + emptyState(
    icons.week(26),
    'No time this week yet',
    'Daily totals and payroll-style weekly totals will show here, measured against 40 hours.',
  );
}
