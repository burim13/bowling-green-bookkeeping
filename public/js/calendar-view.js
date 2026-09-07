import { getOccurrenceInMonth, getOccurrencesInRange, describeRecurrence, toISODate } from "./recurrence.js?v=1788760294461";
import { colorFor } from "./colors.js?v=1788760294461";
import { iconChevronLeft, iconChevronRight } from "./icons.js?v=1788760294461";
import { escapeHtml } from "./html-safety.js?v=1788760294461";

function isDone(state, itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return !!(forItem && forItem.has(periodKey));
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function matchesFilters(state, ctx, item) {
  if (ctx.clientFilter && item.clientId !== ctx.clientFilter) return false;
  if (ctx.categoryFilter && item.category !== ctx.categoryFilter) return false;
  if (!ctx.showArchived && state.clients.get(item.clientId)?.archived) return false;
  return true;
}

function itemColor(colorMode, item) {
  return colorMode === "category" ? colorFor(item.category) : colorFor(item.clientId);
}

// ctx: { state, year, month, colorMode, clientFilter, categoryFilter, showArchived,
//        onPrev, onNext, onToday, onJumpToMonth, onDayClick, onColorModeChange }
export function renderCalendar(container, ctx) {
  const { state, year, month, colorMode } = ctx;

  // Bucket occurrences by day-of-month for the displayed month.
  const dayBuckets = new Map(); // day -> [{item, periodKey}]
  for (const item of state.items.values()) {
    if (!matchesFilters(state, ctx, item)) continue;
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
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
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
      const isPast = new Date(year, month, day) < todayMidnight;
      const weekday = new Date(year, month, day).getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const dots = entries
        .slice(0, 4)
        .map(({ item, periodKey }) => {
          const color = itemColor(colorMode, item);
          const done = isDone(state, item.id, periodKey);
          const overdue = isPast && !done;
          return `<span class="cal-dot ${done ? "cal-dot-done" : ""} ${overdue ? "cal-dot-overdue" : ""}" style="background:${color}" title="${escapeHtml(labelFor(item, state))}"></span>`;
        })
        .join("");
      const more = entries.length > 4 ? `<span class="cal-more">+${entries.length - 4}</span>` : "";
      return `
        <div class="cal-cell ${isToday ? "cal-cell-today" : ""} ${isWeekend ? "cal-cell-weekend" : ""}" data-day="${day}" role="button" tabindex="0">
          <div class="cal-cell-num">${day}${isToday ? '<span class="cal-today-badge">Today</span>' : ""}</div>
          <div class="cal-cell-dots">${dots}${more}</div>
        </div>`;
    })
    .join("");

  // Legend: only the client/category names actually appearing this month, not every one that
  // exists -- keeps it short and relevant instead of an ever-growing key nobody reads.
  const legendEntries = new Map(); // label -> color
  for (const entries of dayBuckets.values()) {
    for (const { item } of entries) {
      const label = colorMode === "category" ? item.category : state.clients.get(item.clientId)?.name || "Unknown client";
      legendEntries.set(label, itemColor(colorMode, item));
    }
  }
  const legendHtml =
    legendEntries.size > 0
      ? `<div class="cal-legend">${[...legendEntries.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([label, color]) => `<span class="cal-legend-item"><span class="cal-legend-dot" style="background:${color}"></span>${escapeHtml(label)}</span>`)
          .join("")}</div>`
      : "";

  // Agenda strip: always the next 7 real days regardless of which month is being browsed --
  // a quick-glance, actionable list of names (not just dots) for immediate planning.
  const agendaDays = buildAgendaDays(state, ctx);
  const agendaHtml = `
    <div class="cal-agenda">
      <div class="cal-agenda-title">Next 7 days</div>
      <div class="cal-agenda-strip">
        ${agendaDays
          .map(({ date, entries }) => {
            const shown = entries.slice(0, 3);
            const extra = entries.length - shown.length;
            return `
            <div class="cal-agenda-day" data-agenda-date="${toISODate(date)}">
              <div class="cal-agenda-day-head">${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()}</div>
              ${
                entries.length === 0
                  ? `<div class="cal-agenda-empty">Nothing due</div>`
                  : shown
                      .map(
                        ({ item }) =>
                          `<div class="cal-agenda-item"><span class="cal-agenda-dot" style="background:${itemColor(colorMode, item)}"></span><span class="cal-agenda-item-label">${escapeHtml(shortLabelFor(item, state))}</span></div>`
                      )
                      .join("") + (extra > 0 ? `<div class="cal-agenda-more">+${extra} more</div>` : "")
              }
            </div>`;
          })
          .join("")}
      </div>
    </div>`;

  container.innerHTML = `
    <div class="cal-header">
      <button class="btn btn-ghost btn-icon" data-action="prev" aria-label="Previous month">${iconChevronLeft}</button>
      <button class="cal-title" data-action="jump" title="Jump to a month">${MONTH_NAMES[month]} ${year}</button>
      <button class="btn btn-ghost btn-icon" data-action="next" aria-label="Next month">${iconChevronRight}</button>
      <button class="btn btn-ghost" data-action="today">Today</button>
      <label class="cal-colormode">
        Color by
        <select data-action="colormode">
          <option value="client" ${colorMode === "client" ? "selected" : ""}>Client</option>
          <option value="category" ${colorMode === "category" ? "selected" : ""}>Category</option>
        </select>
      </label>
    </div>
    ${agendaHtml}
    <div class="cal-grid cal-grid-head">
      ${WEEKDAY_NAMES.map((w) => `<div class="cal-weekday">${w}</div>`).join("")}
    </div>
    <div class="cal-grid">${cellsHtml}</div>
    ${legendHtml}
  `;

  container.querySelector('[data-action="prev"]').addEventListener("click", ctx.onPrev);
  container.querySelector('[data-action="next"]').addEventListener("click", ctx.onNext);
  container.querySelector('[data-action="today"]').addEventListener("click", ctx.onToday);
  container.querySelector('[data-action="jump"]').addEventListener("click", ctx.onJumpToMonth);
  container.querySelector('[data-action="colormode"]').addEventListener("change", (e) => ctx.onColorModeChange(e.target.value));

  container.querySelectorAll(".cal-cell[data-day]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const day = Number(cell.dataset.day);
      const entries = dayBuckets.get(day) || [];
      ctx.onDayClick(new Date(year, month, day), entries);
    });
  });

  container.querySelectorAll(".cal-agenda-day").forEach((dayEl) => {
    dayEl.addEventListener("click", () => {
      const iso = dayEl.dataset.agendaDate;
      const match = agendaDays.find((d) => toISODate(d.date) === iso);
      if (match) ctx.onDayClick(match.date, match.entries);
    });
  });
}

function buildAgendaDays(state, ctx) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(today);
  rangeEnd.setDate(rangeEnd.getDate() + 6);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push({ date: d, entries: [] });
  }
  const byIso = new Map(days.map((d) => [toISODate(d.date), d]));

  for (const item of state.items.values()) {
    if (!matchesFilters(state, ctx, item)) continue;
    for (const occ of getOccurrencesInRange(item, today, rangeEnd)) {
      const bucket = byIso.get(toISODate(occ.date));
      if (bucket) bucket.entries.push({ item, periodKey: occ.periodKey });
    }
  }
  return days;
}

function labelFor(item, state) {
  const client = state.clients.get(item.clientId);
  const label = item.customLabel || item.category;
  return `${client ? client.name : "Unknown client"} — ${label} (${describeRecurrence(item)})`;
}

function shortLabelFor(item, state) {
  const client = state.clients.get(item.clientId);
  const label = item.customLabel || item.category;
  return `${client ? client.name : "Unknown"}: ${label}`;
}
