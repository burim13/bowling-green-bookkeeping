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

// Sidebar nav icons.
export const iconCalendar = svg(
  `<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M3 8h14"/><path d="M7 2.5v3"/><path d="M13 2.5v3"/>`
);
export const iconListView = svg(
  `<path d="M7.5 5.5h9"/><path d="M7.5 10h9"/><path d="M7.5 14.5h9"/><path d="M3.5 5.5h.01"/><path d="M3.5 10h.01"/><path d="M3.5 14.5h.01"/>`
);
const FOLDER_PATH = `<path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z"/>`;
export const iconFolder = svg(FOLDER_PATH);
export const iconFolderLarge = svg(FOLDER_PATH, { size: 22 });

export const iconHome = svg(
  `<path d="M4 9.5 10 4l6 5.5"/><path d="M5.5 8.5V16h9V8.5"/>`
);

// Overview stat-card icons.
export const iconUsers = svg(
  `<circle cx="7" cy="7" r="2.4"/><path d="M2.5 16v-1.2A3.3 3.3 0 0 1 5.8 11.5h2.4A3.3 3.3 0 0 1 11.5 14.8V16"/><circle cx="14" cy="7.5" r="1.9"/><path d="M12.7 16v-0.9a2.8 2.8 0 0 1 2.8-2.8h.2"/>`
);
export const iconAlertTriangle = svg(
  `<path d="M10 3.2 17.3 15.8H2.7z"/><path d="M10 8v3.2"/><circle cx="10" cy="13.6" r="0.6" fill="currentColor" stroke="none"/>`
);
export const iconSignature = svg(
  `<path d="M2.5 15c2-0.8 3-3.6 4-5.6s1.8-1.8 2.3 0 .3 3 1.8 1 2-2.8 3.4-2.8 1.5 1.8 2 2.8"/><path d="M2.5 17h15"/>`
);

// Document list / dropzone icons.
export const iconFile = svg(
  `<path d="M6 2.5h5.5L15 6v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M11.5 2.5V6H15"/>`
);
export const iconUploadLarge = svg(
  `<path d="M10 13V4"/><path d="M6.5 7.5 10 4l3.5 3.5"/><path d="M4 13.5v1.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.5"/>`,
  { size: 22 }
);
export const iconDownload = svg(
  `<path d="M10 3v9"/><path d="M6.5 8.5 10 12l3.5-3.5"/><path d="M4 15.5h12"/>`
);
export const iconClock = svg(
  `<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.6 2.6"/>`
);

// Theme toggle + toolbar overflow menu icons.
export const iconSun = svg(
  `<circle cx="10" cy="10" r="3.2"/><path d="M10 3v1.6"/><path d="M10 15.4V17"/><path d="M3 10h1.6"/><path d="M15.4 10H17"/><path d="M5.2 5.2l1.1 1.1"/><path d="M13.7 13.7l1.1 1.1"/><path d="M14.8 5.2l-1.1 1.1"/><path d="M6.3 13.7l-1.1 1.1"/>`
);
export const iconMoon = svg(`<path d="M15.5 12.3A6.5 6.5 0 0 1 7.7 4.5a6.5 6.5 0 1 0 7.8 7.8z"/>`);
export const iconEllipsis = svg(
  `<circle cx="4.5" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none"/>`
);
export const iconSearch = svg(`<circle cx="8.7" cy="8.7" r="5.4"/><path d="m16.5 16.5-3.9-3.9"/>`);
