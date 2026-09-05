// Recurrence + period-key logic.
//
// Every recurrence type is modeled as "repeat every N months, on day D of the month",
// counted from the item's startDate:
//   monthly   -> N = 1
//   quarterly -> N = 3
//   annually  -> N = 12
//   custom    -> N = recurrenceInterval (>= 1)
//
// This one rule covers all four types, so occurrence math only has to be written once.

export function parseISODate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function intervalMonths(item) {
  switch (item.recurrenceType) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "annually":
      return 12;
    case "custom":
      return Math.max(1, item.recurrenceInterval || 1);
    default:
      return 1;
  }
}

function daysInMonth(year, month) {
  // month is 0-11; day 0 of next month = last day of this month.
  return new Date(year, month + 1, 0).getDate();
}

// Returns the period key an occurrence in `year`/`month` (0-11) belongs to.
// Monthly & custom share the "YYYY-MM" shape since both can recur more than once a year.
export function getPeriodKey(item, year, month) {
  if (item.recurrenceType === "annually") return `${year}`;
  if (item.recurrenceType === "quarterly") return `${year}-Q${Math.floor(month / 3) + 1}`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

// If `item` has an occurrence in the given calendar month, returns { date, periodKey }.
// Otherwise returns null. `year`/`month` describe the month being checked (month is 0-11).
export function getOccurrenceInMonth(item, year, month) {
  const start = parseISODate(item.startDate);
  const startYear = start.getFullYear();
  const startMonth = start.getMonth();

  const diff = (year - startYear) * 12 + (month - startMonth);
  if (diff < 0) return null;

  const n = intervalMonths(item);
  if (diff % n !== 0) return null;

  const preferredDay = item.recurrenceDayOfMonth || start.getDate();
  const day = Math.min(preferredDay, daysInMonth(year, month));
  const date = new Date(year, month, day);

  return { date, periodKey: getPeriodKey(item, year, month) };
}

// Returns every occurrence of `item` whose date falls within [rangeStart, rangeEnd] (inclusive).
// Used by the list view, which shows a rolling window rather than one month at a time.
export function getOccurrencesInRange(item, rangeStart, rangeEnd) {
  const occurrences = [];
  const cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
  const endCursor = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

  while (cursor <= endCursor) {
    const occurrence = getOccurrenceInMonth(item, cursor.getFullYear(), cursor.getMonth());
    if (occurrence && occurrence.date >= rangeStart && occurrence.date <= rangeEnd) {
      occurrences.push(occurrence);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return occurrences;
}

export function describeRecurrence(item) {
  switch (item.recurrenceType) {
    case "monthly":
      return "Monthly";
    case "quarterly":
      return "Quarterly";
    case "annually":
      return "Annually";
    case "custom": {
      const n = item.recurrenceInterval || 1;
      return n === 1 ? "Every month" : `Every ${n} months`;
    }
    default:
      return item.recurrenceType;
  }
}
