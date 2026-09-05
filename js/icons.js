// Small hand-rolled inline SVG icon set -- no icon-font/library dependency. Each export is a
// ready-to-use <svg> string sized to inherit color via currentColor, so it can be dropped
// straight into a template literal and styled from CSS like any other inline element.
const svg = (paths, { viewBox = "0 0 20 20", size = 14 } = {}) =>
  `<svg viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const iconEdit = svg(
  `<path d="M13.5 3.5a1.6 1.6 0 0 1 2.3 2.3L6.8 14.8l-3 .8.8-3z"/>`
);

export const iconTrash = svg(
  `<path d="M4 5.5h12"/><path d="M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5"/><path d="M5.5 5.5 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-10.5"/><path d="M8.3 8.5v5"/><path d="M11.7 8.5v5"/>`
);

export const iconPlus = svg(`<path d="M10 4.5v11"/><path d="M4.5 10h11"/>`);

export const iconChevronLeft = svg(`<path d="M12 4.5 6.5 10l5.5 5.5"/>`);
export const iconChevronRight = svg(`<path d="M8 4.5 13.5 10 8 15.5"/>`);
export const iconCheck = svg(`<path d="M4 10.5 8 14.5 16 5.5"/>`);

// Larger badge-sized versions, for empty states.
export const iconPlusLarge = svg(`<path d="M10 4.5v11"/><path d="M4.5 10h11"/>`, { size: 22 });
export const iconCheckLarge = svg(`<path d="M4 10.5 8 14.5 16 5.5"/>`, { size: 22 });

// Header action icons -- used with a text label that collapses to icon-only on narrow screens.
export const iconTag = svg(
  `<path d="M3 3h6.5L17 10.5 10.5 17 3 9.5V3z"/><circle cx="6.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>`
);
export const iconUpload = svg(
  `<path d="M10 13V4"/><path d="M6.5 7.5 10 4l3.5 3.5"/><path d="M4 13.5v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5"/>`
);
export const iconLogout = svg(
  `<path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/><path d="M13 7l3 3-3 3"/><path d="M16 10H8"/>`
);
