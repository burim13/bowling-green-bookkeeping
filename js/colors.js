// Stable color assignment for calendar color-coding (by client or by category).
// Hash-based so a given client/category always gets the same color even as the
// clients/categories list is reordered or filtered.
const PALETTE = [
  "#e07a5f", "#3d5a80", "#81b29a", "#f2cc8f", "#9b5de5",
  "#00bbf9", "#f15bb5", "#457b9d", "#e76f51", "#588157",
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
