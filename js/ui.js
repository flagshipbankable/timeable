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
