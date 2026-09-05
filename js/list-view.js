import { getOccurrencesInRange, getLastDueOccurrence, describeRecurrence, toISODate } from "./recurrence.js";
import { colorFor } from "./colors.js";

function completionFor(state, itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return forItem ? forItem.get(periodKey) || null : null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 24 * 60 * 60 * 1000;

// ctx: { state, clientFilter, rangeStart, rangeEnd, onToggleComplete, onEditItem }
export function renderList(container, ctx) {
  const { state, rangeStart, rangeEnd } = ctx;
  const today = new Date(new Date().setHours(0, 0, 0, 0));

  // Overdue = each item's most recent due-by-today occurrence, if it's still unchecked. Computed
  // over *all* items regardless of the rolling window below, since a miss from months ago
  // shouldn't quietly scroll out of view.
  const overdueRows = [];
  const overdueKeys = new Set(); // "itemId|periodKey", so the window below doesn't duplicate these
  for (const item of state.items.values()) {
    if (ctx.clientFilter && item.clientId !== ctx.clientFilter) continue;
    const occ = getLastDueOccurrence(item, today);
    if (!occ || occ.date >= today) continue; // due today or in the future isn't "overdue" yet
    if (completionFor(state, item.id, occ.periodKey)) continue;
    overdueRows.push({ item, ...occ });
    overdueKeys.add(`${item.id}|${occ.periodKey}`);
  }
  overdueRows.sort((a, b) => a.date - b.date);

  const rows = [];
  for (const item of state.items.values()) {
    if (ctx.clientFilter && item.clientId !== ctx.clientFilter) continue;
    for (const occ of getOccurrencesInRange(item, rangeStart, rangeEnd)) {
      if (overdueKeys.has(`${item.id}|${occ.periodKey}`)) continue;
      rows.push({ item, ...occ });
    }
  }
  rows.sort((a, b) => a.date - b.date);

  if (rows.length === 0 && overdueRows.length === 0) {
    container.innerHTML = `<div class="list-empty">Nothing due in this window.</div>`;
    return;
  }

  let html = "";

  if (overdueRows.length > 0) {
    html += `<div class="list-group list-group-overdue">
      <div class="list-group-header list-group-header-overdue">Overdue (${overdueRows.length})</div>
      ${overdueRows.map((row) => rowHtml(row, state, today)).join("")}
    </div>`;
  }

  const groups = new Map(); // isoDate -> rows[]
  for (const row of rows) {
    const key = toISODate(row.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const [isoDate, groupRows] of groups) {
    const date = groupRows[0].date;
    html += `<div class="list-group">
      <div class="list-group-header">${WEEKDAY_NAMES[date.getDay()]}, ${date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
      ${groupRows.map((row) => rowHtml(row, state, today)).join("")}
    </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("change", () => {
      const { itemId, clientId, periodKey } = el.dataset;
      ctx.onToggleComplete(clientId, itemId, periodKey, el.checked);
    });
  });

  container.querySelectorAll('[data-action="edit-item"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      ctx.onEditItem(btn.dataset.clientId, btn.dataset.itemId);
    });
  });
}

function rowHtml({ item, periodKey, date }, state, today) {
  const client = state.clients.get(item.clientId);
  const completion = completionFor(state, item.id, periodKey);
  const done = !!completion;
  const overdue = !done && date < today;
  const label = item.customLabel || item.category;
  const color = colorFor(item.clientId);
  const daysOverdue = overdue ? Math.round((today - date) / DAY_MS) : 0;

  return `
    <div class="list-row ${done ? "list-row-done" : ""} ${overdue ? "list-row-overdue" : ""}">
      <label style="display:flex; align-items:center; gap:0.6rem; flex:1; cursor:pointer;">
        <input type="checkbox" data-toggle data-item-id="${item.id}" data-client-id="${item.clientId}" data-period-key="${periodKey}" ${done ? "checked" : ""} />
        <span class="list-row-dot" style="background:${color}"></span>
        <span class="list-row-client">${client ? client.name : "Unknown client"}</span>
        <span class="list-row-label">${label}${item.customLabel ? ` <em>(${item.category})</em>` : ""}</span>
        <span class="list-row-recurrence">${describeRecurrence(item)}</span>
        ${overdue ? `<span class="list-row-overdue-tag">${daysOverdue}d overdue</span>` : ""}
        ${completion ? `<span class="list-row-completed-by">done by ${completion.completedBy}</span>` : ""}
      </label>
      <button class="icon-btn" data-action="edit-item" data-item-id="${item.id}" data-client-id="${item.clientId}" title="Edit or remove item">✎</button>
    </div>`;
}
