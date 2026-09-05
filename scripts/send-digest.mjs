// Daily digest: overdue items + items due in the next 7 days, emailed via Resend.
// Skips sending entirely if there's nothing to report, so the owner isn't emailed on quiet days.
//
// Reuses the exact same recurrence math the front end uses (js/recurrence.js) so the digest
// can never disagree with what the app itself shows as due/overdue.
import { initAdmin, admin } from "./firebase-admin-init.mjs";
import { getLastDueOccurrence, getOccurrencesInRange, describeRecurrence } from "../js/recurrence.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL;
const DIGEST_FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || "Client Compliance Tracker <onboarding@resend.dev>";

if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
if (!DIGEST_TO_EMAIL) throw new Error("DIGEST_TO_EMAIL is not set.");

initAdmin();
const db = admin.firestore();

const today = new Date(new Date().setHours(0, 0, 0, 0));
const weekAhead = new Date(today);
weekAhead.setDate(weekAhead.getDate() + 6);
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadItems() {
  const clientsSnap = await db.collection("clients").get();
  const clientNames = new Map(clientsSnap.docs.map((d) => [d.id, d.data().name]));

  const items = [];
  for (const clientDoc of clientsSnap.docs) {
    const itemsSnap = await clientDoc.ref.collection("items").get();
    for (const itemDoc of itemsSnap.docs) {
      items.push({ id: itemDoc.id, clientId: clientDoc.id, ...itemDoc.data() });
    }
  }
  return { items, clientNames };
}

async function isCompleted(clientId, itemId, periodKey) {
  const doc = await db
    .collection("clients").doc(clientId)
    .collection("items").doc(itemId)
    .collection("completions").doc(periodKey)
    .get();
  return doc.exists;
}

function labelFor(item) {
  return item.customLabel || item.category;
}

async function main() {
  const { items, clientNames } = await loadItems();

  const overdue = [];
  const dueThisWeek = [];

  for (const item of items) {
    const lastDue = getLastDueOccurrence(item, today);
    if (lastDue && lastDue.date < today && !(await isCompleted(item.clientId, item.id, lastDue.periodKey))) {
      const daysOverdue = Math.round((today - lastDue.date) / DAY_MS);
      overdue.push({ item, occurrence: lastDue, daysOverdue });
    }

    for (const occ of getOccurrencesInRange(item, today, weekAhead)) {
      if (await isCompleted(item.clientId, item.id, occ.periodKey)) continue;
      dueThisWeek.push({ item, occurrence: occ });
    }
  }

  if (overdue.length === 0 && dueThisWeek.length === 0) {
    console.log("Nothing overdue or due this week -- skipping email.");
    return;
  }

  overdue.sort((a, b) => a.occurrence.date - b.occurrence.date);
  dueThisWeek.sort((a, b) => a.occurrence.date - b.occurrence.date);

  const clientName = (id) => clientNames.get(id) || "Unknown client";
  const dateStr = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const overdueLines = overdue.map(
    ({ item, occurrence, daysOverdue }) =>
      `- ${clientName(item.clientId)}: ${labelFor(item)} (due ${dateStr(occurrence.date)}, ${daysOverdue}d overdue)`
  );
  const dueThisWeekLines = dueThisWeek.map(
    ({ item, occurrence }) =>
      `- ${clientName(item.clientId)}: ${labelFor(item)} (due ${dateStr(occurrence.date)}, ${describeRecurrence(item)})`
  );

  const text = [
    overdue.length ? `OVERDUE (${overdue.length})\n${overdueLines.join("\n")}` : null,
    dueThisWeek.length ? `DUE IN THE NEXT 7 DAYS (${dueThisWeek.length})\n${dueThisWeekLines.join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const html = [
    overdue.length
      ? `<h2 style="color:#c0392b">Overdue (${overdue.length})</h2><ul>${overdue
          .map(
            ({ item, occurrence, daysOverdue }) =>
              `<li><strong>${escapeHtml(clientName(item.clientId))}</strong>: ${escapeHtml(labelFor(item))} (due ${dateStr(occurrence.date)}, ${daysOverdue}d overdue)</li>`
          )
          .join("")}</ul>`
      : "",
    dueThisWeek.length
      ? `<h2>Due in the next 7 days (${dueThisWeek.length})</h2><ul>${dueThisWeek
          .map(
            ({ item, occurrence }) =>
              `<li><strong>${escapeHtml(clientName(item.clientId))}</strong>: ${escapeHtml(labelFor(item))} (due ${dateStr(occurrence.date)}, ${escapeHtml(describeRecurrence(item))})</li>`
          )
          .join("")}</ul>`
      : "",
  ].join("");

  const subject = `Compliance digest: ${overdue.length} overdue, ${dueThisWeek.length} due this week`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: DIGEST_FROM_EMAIL,
      to: [DIGEST_TO_EMAIL],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }

  console.log(`Digest sent: ${overdue.length} overdue, ${dueThisWeek.length} due this week.`);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
