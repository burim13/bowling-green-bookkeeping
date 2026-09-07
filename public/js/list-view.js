import { getOccurrencesInRange, getLastDueOccurrence, describeRecurrence, toISODate } from "./recurrence.js?v=1788800373942";
import { colorFor } from "./colors.js?v=1788800373942";
import { iconEdit, iconCheckLarge } from "./icons.js?v=1788800373942";
import { escapeHtml } from "./html-safety.js?v=1788800373942";
import { categoryOptions } from "./calendar-view.js?v=1788800373942";

function completionFor(state, itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return forItem ? forItem.get(periodKey) || null : null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_MS = 24 * 60 * 60 * 1000;

// ctx: { state, clientFilter, categoryFilter, showArchived, rangeStart, rangeEnd, onToggleComplete,
// onEditItem, readOnly, showFilterHeader, onClientFilterChange, onCategoryFilterChange,
// onMarkAllComplete }. readOnly
// (used by the client-facing Compliance view -- a client has no Firestore permission to toggle
// completion or edit items, so those controls would just fail silently if shown) disables the
// checkbox and omits the edit button entirely. showFilterHeader (used only by the staff List
// view -- NOT the per-client Compliance tab, which is already scoped to one client, and NOT the
// client-facing Compliance view, which has nothing to filter) renders the client filter + "mark
// all shown complete" inside the list itself instead of a page-level toolbar.
// Returns the list of currently-rendered, not-yet-complete rows ({ clientId, itemId, periodKey }),
// so callers can offer a "mark all shown complete" bulk action without recomputing the filtering.
export function renderList(container, ctx) {
  const { state, rangeStart, rangeEnd, readOnly } = ctx;
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const matchesFilters = (item) =>
    (!ctx.clientFilter || item.clientId === ctx.clientFilter) &&
    (!ctx.categoryFilter || item.category === ctx.categoryFilter) &&
    (ctx.showArchived || !state.clients.get(item.clientId)?.archived);

  // Overdue = each item's most recent due-by-today occurrence, if it's still unchecked. Computed
  // over *all* items regardless of the rolling window below, since a miss from months ago
  // shouldn't quietly scroll out of view.
  const overdueRows = [];
  const overdueKeys = new Set(); // "itemId|periodKey", so the window below doesn't duplicate these
  for (const item of state.items.values()) {
    if (!matchesFilters(item)) continue;
    const occ = getLastDueOccurrence(item, today);
    if (!occ || occ.date >= today) continue; // due today or in the future isn't "overdue" yet
    if (completionFor(state, item.id, occ.periodKey)) continue;
    overdueRows.push({ item, ...occ });
    overdueKeys.add(`${item.id}|${occ.periodKey}`);
  }
  overdueRows.sort((a, b) => a.date - b.date);

  const rows = [];
  for (const item of state.items.values()) {
    if (!matchesFilters(item)) continue;
    for (const occ of getOccurrencesInRange(item, rangeStart, rangeEnd)) {
      if (overdueKeys.has(`${item.id}|${occ.periodKey}`)) continue;
      rows.push({ item, ...occ });
    }
  }
  rows.sort((a, b) => a.date - b.date);

  // Only rows actually due (today or overdue) are eligible for bulk-complete -- a future
  // month's occurrence hasn't happened yet, so marking it complete now would be simply wrong,
  // even though it's still shown in the list for forward planning.
  const incompleteRows = [
    ...overdueRows,
    ...rows.filter((r) => r.date <= today && !completionFor(state, r.item.id, r.periodKey)),
  ].map(({ item, periodKey }) => ({ clientId: item.clientId, itemId: item.id, periodKey }));

  const headerHtml = ctx.showFilterHeader
    ? `<div class="list-header">
        <div class="cal-filters">
          <label class="cal-filter-item">
            Client
            <select data-action="clientfilter">
              <option value="">All clients</option>
              ${[...state.clients.values()]
                .filter((c) => ctx.showArchived || !c.archived)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => `<option value="${c.id}" ${ctx.clientFilter === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`)
                .join("")}
            </select>
          </label>
          <label class="cal-filter-item">
            Category
            <select data-action="categoryfilter">
              <option value="">All categories</option>
              ${categoryOptions(state)
                .map((c) => `<option value="${escapeHtml(c)}" ${ctx.categoryFilter === c ? "selected" : ""}>${escapeHtml(c)}</option>`)
                .join("")}
            </select>
          </label>
        </div>
        <button type="button" class="btn btn-success" data-action="mark-all">Mark all shown complete</button>
      </div>`
    : "";

  if (rows.length === 0 && overdueRows.length === 0) {
    container.innerHTML =
      headerHtml +
      `<div class="empty-state">
        <div class="empty-state-badge empty-state-badge-success">${iconCheckLarge}</div>
        <h3>All caught up</h3>
        <p>Nothing due in this window.</p>
      </div>`;
    wireFilterHeader(container, ctx);
    return incompleteRows;
  }

  let html = headerHtml;

  if (overdueRows.length > 0) {
    html += `<div class="list-group list-group-overdue">
      <div class="list-group-header list-group-header-overdue">Overdue (${overdueRows.length})</div>
      ${overdueRows.map((row) => rowHtml(row, state, today, readOnly)).join("")}
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
      ${groupRows.map((row) => rowHtml(row, state, today, readOnly)).join("")}
    </div>`;
  }
  container.innerHTML = html;

  if (!readOnly) {
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

  wireFilterHeader(container, ctx);
  return incompleteRows;
}

function wireFilterHeader(container, ctx) {
  if (!ctx.showFilterHeader) return;
  container.querySelector('[data-action="clientfilter"]').addEventListener("change", (e) => {
    ctx.onClientFilterChange(e.target.value || null);
  });
  container.querySelector('[data-action="categoryfilter"]').addEventListener("change", (e) => {
    ctx.onCategoryFilterChange(e.target.value || null);
  });
  container.querySelector('[data-action="mark-all"]').addEventListener("click", ctx.onMarkAllComplete);
}

function rowHtml({ item, periodKey, date }, state, today, readOnly) {
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
        <input type="checkbox" ${readOnly ? "disabled" : ""} data-toggle data-item-id="${item.id}" data-client-id="${item.clientId}" data-period-key="${periodKey}" ${done ? "checked" : ""} />
        <span class="list-row-dot" style="background:${color}"></span>
        <span class="list-row-client">${escapeHtml(client ? client.name : "Unknown client")}</span>
        <span class="list-row-label">${escapeHtml(label)}${item.customLabel ? ` <em>(${escapeHtml(item.category)})</em>` : ""}</span>
        <span class="list-row-recurrence">${describeRecurrence(item)}</span>
        ${overdue ? `<span class="list-row-overdue-tag">${daysOverdue}d overdue</span>` : ""}
        ${completion ? `<span class="list-row-completed-by">done by ${escapeHtml(completion.completedBy)}</span>` : ""}
      </label>
      ${readOnly ? "" : `<button class="icon-btn" data-action="edit-item" data-item-id="${item.id}" data-client-id="${item.clientId}" title="Edit or remove item">${iconEdit}</button>`}
    </div>`;
}
