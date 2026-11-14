import { icons } from '../icons.js';
import { emptyState, heading } from '../ui.js';

export function render(el) {
  el.innerHTML = heading('Week', 'Monday through Sunday') + emptyState(
    icons.week(26),
    'Week totals arrive in the next update',
    'Each day\u2019s total and payroll-style weekly totals will show here, measured against 40 hours. For now, the Desk shows this week\u2019s total.',
  );
}
