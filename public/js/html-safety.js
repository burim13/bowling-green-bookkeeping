// Single source of truth for escaping user-supplied text before it's interpolated into an
// innerHTML template string. Previously duplicated (app.js had its own escapeHtml;
// calendar-view.js had a separate, weaker escapeAttr that skipped `&` and `>`) and some render
// paths -- list-view.js's client name, item label/category, and completedBy -- used neither,
// so a script-laden category or client name (entered by any staff account) would execute in
// every other viewer's browser, including a client's own read-only Compliance tab.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
