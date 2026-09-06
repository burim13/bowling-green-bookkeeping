// Stable color assignment for calendar color-coding (by client or by category).
// Hash-based so a given client/category always gets the same color even as the
// clients/categories list is reordered or filtered.
// A curated, evenly-saturated set (no neon/pastel, no pure red -- that's reserved for
// danger/overdue elsewhere in the UI) rather than an ad hoc grab-bag of hues.
const PALETTE = [
  "#2563eb", "#7c3aed", "#0891b2", "#059669", "#d97706",
  "#db2777", "#4f46e5", "#0d9488", "#ca8a04", "#475569",
];

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorFor(key) {
  return PALETTE[hash(String(key)) % PALETTE.length];
}

// A soft tint of a palette color for badge/avatar backgrounds (paired with the solid color as
// the foreground) -- same light-fill-plus-solid-text pattern as .empty-state-badge-primary.
export function tintFor(hex, alpha = 0.14) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
