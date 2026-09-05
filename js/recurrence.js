// Recurrence + period-key logic.
//
// Every recurrence type is modeled as "repeat every N months, on day D of the month",
// counted from an anchor date:
//   monthly   -> N = 1
//   quarterly -> N = 3
//   annually  -> N = 12
//   custom    -> N = recurrenceInterval (>= 1)
//
// This one rule covers all four types, so occurrence math only has to be written once.
//
// An item's *current* rule (recurrenceType/recurrenceInterval/recurrenceDayOfMonth, anchored at
// startDate) normally applies for the item's entire life. If the cadence was changed partway
// through (e.g. monthly -> quarterly starting a given month), the item additionally carries:
//   priorRule: { recurrenceType, recurrenceInterval, recurrenceDayOfMonth } | null
//   currentRuleEffectiveFrom: "YYYY-MM-DD" | null
// -- meaning "before this month, use priorRule (still anchored at startDate); from this month
// on, use the current top-level rule, now anchored at currentRuleEffectiveFrom instead of
// startDate." This lets history stay computed under the old cadence instead of being silently
// reinterpreted under the new one.

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

function intervalMonthsForRule(rule) {
  switch (rule.recurrenceType) {
    case "monthly":
      return 1;
    case "quarterly":
      return 3;
    case "annually":
      return 12;
    case "custom":
      return Math.max(1, rule.recurrenceInterval || 1);
    default:
      return 1;
  }
}

function periodKeyForRule(rule, year, month) {
  if (rule.recurrenceType === "annually") return `${year}`;
  if (rule.recurrenceType === "quarterly") return `${year}-Q${Math.floor(month / 3) + 1}`;
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  // month is 0-11; day 0 of next month = last day of this month.
  return new Date(year, month + 1, 0).getDate();
}

// Picks which rule (current vs. prior) governs a given calendar month, and what it's anchored to.
function resolveRule(item, year, month) {
  const currentRule = {
    anchor: parseISODate(item.startDate),
    recurrenceType: item.recurrenceType,
    recurrenceInterval: item.recurrenceInterval,
    recurrenceDayOfMonth: item.recurrenceDayOfMonth,
  };

  if (!item.priorRule || !item.currentRuleEffectiveFrom) return currentRule;

  const effectiveFrom = parseISODate(item.currentRuleEffectiveFrom);
  const isBeforeEffective =
    year < effectiveFrom.getFullYear() ||
    (year === effectiveFrom.getFullYear() && month < effectiveFrom.getMonth());

  if (isBeforeEffective) {
    return {
      anchor: parseISODate(item.startDate),
      recurrenceType: item.priorRule.recurrenceType,
      recurrenceInterval: item.priorRule.recurrenceInterval,
      recurrenceDayOfMonth: item.priorRule.recurrenceDayOfMonth,
    };
  }

  // The current rule is anchored at the switchover date once one has happened, not the
  // original startDate -- so "quarterly starting September" actually lands on September, not
  // wherever the original monthly anchor's day-of-month would have put it.
  return { ...currentRule, anchor: effectiveFrom };
}

// If `item` has an occurrence in the given calendar month, returns { date, periodKey }.
// Otherwise returns null. `year`/`month` describe the month being checked (month is 0-11).
export function getOccurrenceInMonth(item, year, month) {
  const rule = resolveRule(item, year, month);
  const anchorYear = rule.anchor.getFullYear();
  const anchorMonth = rule.anchor.getMonth();

  const diff = (year - anchorYear) * 12 + (month - anchorMonth);
  if (diff < 0) return null;

  const n = intervalMonthsForRule(rule);
  if (diff % n !== 0) return null;

  const preferredDay = rule.recurrenceDayOfMonth || rule.anchor.getDate();
  const day = Math.min(preferredDay, daysInMonth(year, month));
  const date = new Date(year, month, day);

  return { date, periodKey: periodKeyForRule(rule, year, month) };
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

// Returns the most recent occurrence of `item` whose date is on or before `referenceDate`
// (typically "today"), or null if the recurrence hasn't started yet. Walks backward one month at
// a time rather than jumping by a fixed interval, since the interval itself can change partway
// through an item's life (see the module comment) -- getOccurrenceInMonth already knows which
// rule applies to any given month, so this just has to ask it repeatedly.
export function getLastDueOccurrence(item, referenceDate) {
  const startCursor = (() => {
    const s = parseISODate(item.startDate);
    return new Date(s.getFullYear(), s.getMonth(), 1);
  })();
  const cursor = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);

  let guard = 0;
  while (cursor >= startCursor && guard < 1200) {
    const occurrence = getOccurrenceInMonth(item, cursor.getFullYear(), cursor.getMonth());
    if (occurrence && occurrence.date <= referenceDate) return occurrence;
    cursor.setMonth(cursor.getMonth() - 1);
    guard++;
  }

  return null;
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

function describeRule(rule) {
  return describeRecurrence(rule);
}

// Human-readable summary of an item's recurrence, including its prior cadence if it changed.
// e.g. "Quarterly (was Monthly through Aug 2026)".
export function describeRecurrenceHistory(item) {
  if (!item.priorRule || !item.currentRuleEffectiveFrom) return describeRecurrence(item);
  const effectiveFrom = parseISODate(item.currentRuleEffectiveFrom);
  const lastPriorMonth = new Date(effectiveFrom.getFullYear(), effectiveFrom.getMonth() - 1, 1);
  const lastPriorMonthLabel = lastPriorMonth.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `${describeRecurrence(item)} (was ${describeRule(item.priorRule)} through ${lastPriorMonthLabel})`;
}
