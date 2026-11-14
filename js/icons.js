// Small inline icons, drawn for timeable. Inline SVG means no icon font or
// outside request, and they inherit the text color.

const svg = (body, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  desk: (s) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  day: (s) => svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 10l2 2 4-4"/><path d="M8 16h8"/>', s),
  week: (s) => svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>', s),
  tasks: (s) => svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="5" cy="6" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="5" cy="18" r="1.2"/>', s),
  settings: (s) => svg('<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/>', s),
  share: (s) => svg('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/>', s),
  close: (s) => svg('<path d="M6 6l12 12M18 6L6 18"/>', s),
  refresh: (s) => svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', s),
  star: (s) => svg('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>', s),
  starFilled: (s) => `<svg width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>`,
  plus: (s) => svg('<path d="M12 5v14M5 12h14"/>', s),
  upload: (s) => svg('<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/>', s),
  download: (s) => svg('<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>', s),
  book: (s) => svg('<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>', s),
  warn: (s) => svg('<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>', s),
  back: (s) => svg('<path d="M15 5l-7 7 7 7"/>', s),
  chevron: (s) => svg('<path d="M9 5l7 7-7 7"/>', s),
  more: (s) => `<svg width="${s || 22}" height="${s || 22}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/></svg>`,
  play: (s) => svg('<path d="M8 5.5v13l10.5-6.5z"/>', s),
  clockPlus: (s) => svg('<circle cx="11" cy="12" r="7.5"/><path d="M11 8v4l2.5 1.5"/><path d="M19 3v4M17 5h4"/>', s),
  shield: (s) => svg('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>', s),
};
