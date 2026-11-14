// Shared helpers for building screens.

// Escape text before putting it into HTML. Every value that could come from
// saved data or a typed field must pass through this.
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function heading(title, subtitle) {
  return `<div class="view-heading"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>`;
}

// iconHtml is trusted markup from icons.js; title and text are escaped.
export function emptyState(iconHtml, title, text) {
  return `<section class="card empty"><span class="empty-icon">${iconHtml}</span><h2>${esc(title)}</h2><p>${esc(text)}</p></section>`;
}

// The device's local date, e.g. "Saturday, November 14".
export function todayLabel(date = new Date()) {
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// True when running from the Home Screen rather than in a browser tab.
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// iPadOS reports itself as a Mac, so touch support is checked too.
export function isIOS() {
  const ua = window.navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1);
}

// A short message above the tab bar. With an action (like Undo), it stays
// longer and shows a button; tapping it runs the action and closes the toast.
export function toast(message, { action, onAction, duration } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.innerHTML = `<span class="toast-text">${esc(message)}</span>${action ? `<button type="button" class="toast-action">${esc(action)}</button>` : ''}`;
  el.classList.toggle('has-action', Boolean(action));
  el.classList.add('show');
  clearTimeout(toast.timer);
  const hide = () => { el.classList.remove('show'); clearTimeout(toast.timer); };
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', () => { hide(); onAction(); }, { once: true });
  }
  toast.timer = setTimeout(hide, duration || (action ? 7000 : 3200));
}

// Closes the toast now (for example when a form opens over it).
export function hideToast() {
  const el = document.getElementById('toast');
  if (el) el.classList.remove('show');
  clearTimeout(toast.timer);
}

// "Nov 14, 2026" from an ISO time or a YYYY-MM-DD date, in local time.
export function shortDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// Small settings in localStorage. It can be missing or throw (private
// browsing, storage limits), so failures fall back quietly.
export const prefs = {
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(`timeable.${key}`);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(`timeable.${key}`, JSON.stringify(value));
    } catch {
      // Not critical: the setting just won't be remembered.
    }
  },
};
