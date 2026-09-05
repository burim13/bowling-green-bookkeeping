import { getOccurrencesInRange, describeRecurrence, toISODate } from "./recurrence.js";
import { colorFor } from "./colors.js";

function completionFor(state, itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return forItem ? forItem.get(periodKey) || null : null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ctx: { state, clientFilter, rangeStart, rangeEnd, onToggleComplete }
export function renderList(container, ctx) {
  const { state, rangeStart, rangeEnd } = ctx;

  const rows = [];
  for (const item of state.items.values()) {
    if (ctx.clientFilter && item.clientId !== ctx.clientFilter) continue;
    for (const occ of getOccurrencesInRange(item, rangeStart, rangeEnd)) {
      rows.push({ item, ...occ });
    }
  }
  rows.sort((a, b) => a.date - b.date);

  if (rows.length === 0) {
    container.innerHTML = `<div class="list-empty">Nothing due in this window.</div>`;
    return;
  }

  const groups = new Map(); // isoDate -> rows[]
  for (const row of rows) {
    const key = toISODate(row.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let html = "";
  for (const [isoDate, groupRows] of groups) {
    const date = groupRows[0].date;
    html += `<div class="list-group">
      <div class="list-group-header">${WEEKDAY_NAMES[date.getDay()]}, ${date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</div>
      ${groupRows.map((row) => rowHtml(row, state)).join("")}
    </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll("[data-toggle]").forEach((el) => {
    el.addEventListener("change", () => {
      const { itemId, clientId, periodKey } = el.dataset;
      ctx.onToggleComplete(clientId, itemId, periodKey, el.checked);
    });
  });
}

function rowHtml({ item, periodKey }, state) {
  const client = state.clients.get(item.clientId);
  const completion = completionFor(state, item.id, periodKey);
  const done = !!completion;
  const label = item.customLabel || item.category;
  const color = colorFor(item.clientId);

  return `
    <label class="list-row ${done ? "list-row-done" : ""}">
      <input type="checkbox" data-toggle data-item-id="${item.id}" data-client-id="${item.clientId}" data-period-key="${periodKey}" ${done ? "checked" : ""} />
      <span class="list-row-dot" style="background:${color}"></span>
      <span class="list-row-client">${client ? client.name : "Unknown client"}</span>
      <span class="list-row-label">${label}${item.customLabel ? ` <em>(${item.category})</em>` : ""}</span>
      <span class="list-row-recurrence">${describeRecurrence(item)}</span>
      ${completion ? `<span class="list-row-completed-by">done by ${completion.completedBy}</span>` : ""}
    </label>`;
}
