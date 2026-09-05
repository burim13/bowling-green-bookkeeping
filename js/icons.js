// Small hand-rolled inline SVG icon set -- no icon-font/library dependency. Each export is a
// ready-to-use <svg> string sized to inherit color via currentColor, so it can be dropped
// straight into a template literal and styled from CSS like any other inline element.
const svg = (paths, viewBox = "0 0 20 20") =>
  `<svg viewBox="${viewBox}" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const iconEdit = svg(
  `<path d="M13.5 3.5a1.6 1.6 0 0 1 2.3 2.3L6.8 14.8l-3 .8.8-3z"/>`
);

export const iconTrash = svg(
  `<path d="M4 5.5h12"/><path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M5.5 5.5 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-10.5"/><path d="M8.3 8.5v5"/><path d="M11.7 8.5v5"/>`
);

export const iconPlus = svg(`<path d="M10 4.5v11"/><path d="M4.5 10h11"/>`);

export const iconChevronLeft = svg(`<path d="M12 4.5 6.5 10l5.5 5.5"/>`);
export const iconChevronRight = svg(`<path d="M8 4.5 13.5 10 8 15.5"/>`);
