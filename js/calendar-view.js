import { getOccurrenceInMonth, describeRecurrence } from "./recurrence.js";
import { colorFor } from "./colors.js";

function isDone(state, itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return !!(forItem && forItem.has(periodKey));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ctx: { state, year, month, colorMode, clientFilter, onPrev, onNext, onToday, onDayClick, onColorModeChange }
export function renderCalendar(container, ctx) {
  const { state, year, month, colorMode } = ctx;

  // Bucket occurrences by day-of-month for the displayed month.
  const dayBuckets = new Map(); // day -> [{item, periodKey}]
  for (const item of state.items.values()) {
    if (ctx.clientFilter && item.clientId !== ctx.clientFilter) continue;
    const occ = getOccurrenceInMonth(item, year, month);
    if (!occ) continue;
    const day = occ.date.getDate();
    if (!dayBuckets.has(day)) dayBuckets.set(day, []);
    dayBuckets.get(day).push({ item, periodKey: occ.periodKey });
  }

  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const cellsHtml = cells
    .map((day) => {
      if (day === null) return `<div class="cal-cell cal-cell-empty"></div>`;
      const entries = dayBuckets.get(day) || [];
      const isToday = isCurrentMonth && today.getDate() === day;
      const dots = entries
        .slice(0, 4)
        .map(({ item, periodKey }) => {
          const color = colorMode === "category" ? colorFor(item.category) : colorFor(item.clientId);
          const done = isDone(state, item.id, periodKey);
          return `<span class="cal-dot ${done ? "cal-dot-done" : ""}" style="background:${color}" title="${escapeAttr(labelFor(item, state))}"></span>`;
        })
        .join("");
      const more = entries.length > 4 ? `<span class="cal-more">+${entries.length - 4}</span>` : "";
      return `
        <div class="cal-cell ${isToday ? "cal-cell-today" : ""}" data-day="${day}" role="button" tabindex="0">
          <div class="cal-cell-num">${day}</div>
          <div class="cal-cell-dots">${dots}${more}</div>
        </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="cal-header">
      <button class="btn btn-ghost" data-action="prev" aria-label="Previous month">&larr;</button>
      <div class="cal-title">${MONTH_NAMES[month]} ${year}</div>
      <button class="btn btn-ghost" data-action="next" aria-label="Next month">&rarr;</button>
      <button class="btn btn-ghost" data-action="today">Today</button>
      <label class="cal-colormode">
        Color by
        <select data-action="colormode">
          <option value="client" ${colorMode === "client" ? "selected" : ""}>Client</option>
          <option value="category" ${colorMode === "category" ? "selected" : ""}>Category</option>
        </select>
      </label>
    </div>
    <div class="cal-grid cal-grid-head">
      ${WEEKDAY_NAMES.map((w) => `<div class="cal-weekday">${w}</div>`).join("")}
    </div>
    <div class="cal-grid">${cellsHtml}</div>
  `;

  container.querySelector('[data-action="prev"]').addEventListener("click", ctx.onPrev);
  container.querySelector('[data-action="next"]').addEventListener("click", ctx.onNext);
  container.querySelector('[data-action="today"]').addEventListener("click", ctx.onToday);
  container.querySelector('[data-action="colormode"]').addEventListener("change", (e) => ctx.onColorModeChange(e.target.value));

  container.querySelectorAll(".cal-cell[data-day]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const day = Number(cell.dataset.day);
      const entries = dayBuckets.get(day) || [];
      ctx.onDayClick(new Date(year, month, day), entries);
    });
  });
}

function labelFor(item, state) {
  const client = state.clients.get(item.clientId);
  const label = item.customLabel || item.category;
  return `${client ? client.name : "Unknown client"} — ${label} (${describeRecurrence(item)})`;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}
