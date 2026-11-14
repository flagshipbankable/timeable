// A pop-up panel: slides up from the bottom on a phone, centered on a laptop.
// Used for forms, previews, and confirmations (the browser's own alert and
// confirm boxes are avoided because they look out of place in an app).

import { esc, hideToast } from './ui.js';
import { icons } from './icons.js';

let openCount = 0;
const stack = [];

// title is escaped; bodyHtml is trusted markup built by the caller (which
// escapes any saved data it includes). Returns a close() function.
export function openSheet({ title, bodyHtml, onMount, onClose }) {
  const previousFocus = document.activeElement;
  hideToast(); // a toast from earlier would sit on top of the form
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="sheet-head"><h2>${esc(title)}</h2>
        <button class="icon-button sheet-close" type="button" aria-label="Close">${icons.close(20)}</button></header>
      <div class="sheet-body">${bodyHtml}</div>
    </section>`;
  document.body.append(scrim);
  stack.push(scrim);
  openCount += 1;
  document.body.classList.add('sheet-open');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scrim.remove();
    stack.splice(stack.indexOf(scrim), 1);
    openCount -= 1;
    if (openCount === 0) document.body.classList.remove('sheet-open');
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
    if (previousFocus && previousFocus.focus) previousFocus.focus({ preventScroll: true });
  };
  // With one sheet over another (like Adjust over a form), Escape closes
  // only the top one.
  const onKey = (event) => { if (event.key === 'Escape' && stack[stack.length - 1] === scrim) close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) close(); });
  scrim.querySelector('.sheet-close').addEventListener('click', close);

  const sheet = scrim.querySelector('.sheet');
  if (onMount) onMount(sheet, close);
  const first = sheet.querySelector('[autofocus]') || sheet.querySelector('.sheet-close');
  if (first) first.focus({ preventScroll: true });
  return close;
}
