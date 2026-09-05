// Daily digest: overdue items + items due in the next 7 days, emailed via Resend.
// Skips sending entirely if there's nothing to report, so the owner isn't emailed on quiet days.
//
// Reuses the exact same recurrence math the front end uses (js/recurrence.js) so the digest
// can never disagree with what the app itself shows as due/overdue.
import { fileURLToPath } from "url";
import { initAdmin, admin } from "./firebase-admin-init.mjs";
import { getLastDueOccurrence, getOccurrencesInRange, describeRecurrence } from "../js/recurrence.js";

const APP_URL = process.env.APP_URL || "https://burim13.github.io/client-compliance-tracker/";
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadItems(db) {
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

async function isCompleted(db, clientId, itemId, periodKey) {
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

// How far ahead to warn about an upcoming item, based on how infrequently it recurs -- a
// monthly task rarely needs more than a week's notice, but an annual filing (like a BOI report)
// benefits from a much earlier heads-up than a fixed 7-day window would give it.
function lookaheadDays(item) {
  if (item.recurrenceType === "annually") return 30;
  if (item.recurrenceType === "quarterly") return 14;
  return 7; // monthly, custom
}

async function main() {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const DIGEST_TO_EMAIL = process.env.DIGEST_TO_EMAIL;
  const DIGEST_FROM_EMAIL = process.env.DIGEST_FROM_EMAIL || "Client Compliance Tracker <onboarding@resend.dev>";
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set.");
  if (!DIGEST_TO_EMAIL) throw new Error("DIGEST_TO_EMAIL is not set.");

  initAdmin();
  const db = admin.firestore();

  const today = new Date(new Date().setHours(0, 0, 0, 0));

  const { items, clientNames } = await loadItems(db);

  const overdue = [];
  const dueSoon = [];

  for (const item of items) {
    const lastDue = getLastDueOccurrence(item, today);
    if (lastDue && lastDue.date < today && !(await isCompleted(db, item.clientId, item.id, lastDue.periodKey))) {
      const daysOverdue = Math.round((today - lastDue.date) / DAY_MS);
      overdue.push({ item, occurrence: lastDue, daysOverdue });
    }

    const lookAheadTo = new Date(today);
    lookAheadTo.setDate(lookAheadTo.getDate() + lookaheadDays(item));
    for (const occ of getOccurrencesInRange(item, today, lookAheadTo)) {
      if (await isCompleted(db, item.clientId, item.id, occ.periodKey)) continue;
      dueSoon.push({ item, occurrence: occ });
    }
  }

  if (overdue.length === 0 && dueSoon.length === 0) {
    console.log("Nothing overdue or due soon -- skipping email.");
    return;
  }

  overdue.sort((a, b) => a.occurrence.date - b.occurrence.date);
  dueSoon.sort((a, b) => a.occurrence.date - b.occurrence.date);

  const clientName = (id) => clientNames.get(id) || "Unknown client";
  const dateStr = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const todayStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const text = buildPlainText({ overdue, dueSoon, clientName, dateStr, todayStr });
  const html = buildHtml({ overdue, dueSoon, clientName, dateStr, todayStr });

  const subject = `Compliance digest: ${overdue.length} overdue, ${dueSoon.length} due soon`;

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

  console.log(`Digest sent: ${overdue.length} overdue, ${dueSoon.length} due soon.`);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Groups rows (each carrying an `item`) by client, preserving the order clients first appear in.
function groupByClient(rows, clientName) {
  const groups = new Map(); // clientName -> rows[]
  for (const row of rows) {
    const name = clientName(row.item.clientId);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return groups;
}

function buildPlainText({ overdue, dueSoon, clientName, dateStr, todayStr }) {
  const section = (title, rows, lineFor) => {
    if (rows.length === 0) return `${title}\n  Nothing here -- nice work.`;
    const groups = groupByClient(rows, clientName);
    const body = [...groups.entries()]
      .map(([name, clientRows]) => `  ${name}\n${clientRows.map((r) => `    - ${lineFor(r)}`).join("\n")}`)
      .join("\n");
    return `${title}\n${body}`;
  };

  return [
    `${overdue.length} overdue, ${dueSoon.length} due soon -- ${todayStr}`,
    section(`OVERDUE (${overdue.length})`, overdue, ({ item, occurrence, daysOverdue }) =>
      `${labelFor(item)} -- due ${dateStr(occurrence.date)} (${daysOverdue}d overdue)`
    ),
    section(`DUE SOON (${dueSoon.length})`, dueSoon, ({ item, occurrence }) =>
      `${labelFor(item)} -- due ${dateStr(occurrence.date)} (${describeRecurrence(item)})`
    ),
    `Open the tracker: ${APP_URL}`,
    `--\nAutomated daily digest. This address does not accept replies.`,
  ].join("\n\n");
}

function buildHtml({ overdue, dueSoon, clientName, dateStr, todayStr }) {
  const rowHtml = (label, dueDateText, badgeText, badgeColor) => `
    <tr>
      <td style="padding:8px 12px;background:#f7f5f2;border-radius:6px;font-size:13px;color:#2b2926;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:13px;color:#2b2926;">
            ${escapeHtml(label)}<br/>
            <span style="font-size:12px;color:#7a7369;">Due ${dueDateText}</span>
          </td>
          <td align="right" valign="top" style="font-size:12px;font-weight:600;color:${badgeColor};white-space:nowrap;">
            ${badgeText}
          </td>
        </tr></table>
      </td>
    </tr>
    <tr><td style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>`;

  const clientBlock = (name, rows) => `
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;color:#2b2926;margin-bottom:6px;">${escapeHtml(name)}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>
    </div>`;

  const section = (title, titleColor, rows, rowBuilder) => {
    if (rows.length === 0) {
      return `
        <tr><td style="padding:0 28px 20px;">
          <div style="font-size:13px;font-weight:700;color:${titleColor};text-transform:uppercase;letter-spacing:0.03em;margin-bottom:8px;">${title}</div>
          <div style="font-size:13px;color:#7a7369;">Nothing here -- nice work.</div>
        </td></tr>`;
    }
    const groups = groupByClient(rows, clientName);
    const blocks = [...groups.entries()]
      .map(([name, clientRows]) => clientBlock(name, clientRows.map(rowBuilder)))
      .join("");
    return `
      <tr><td style="padding:0 28px 20px;">
        <div style="font-size:13px;font-weight:700;color:${titleColor};text-transform:uppercase;letter-spacing:0.03em;margin-bottom:10px;">${title}</div>
        ${blocks}
      </td></tr>`;
  };

  const overdueSection = section(`Overdue (${overdue.length})`, "#c0392b", overdue, ({ item, occurrence, daysOverdue }) =>
    rowHtml(labelFor(item), dateStr(occurrence.date), `${daysOverdue}d overdue`, "#c0392b")
  );
  const dueSoonSection = section(`Due soon (${dueSoon.length})`, "#3d5a80", dueSoon, ({ item, occurrence }) =>
    rowHtml(labelFor(item), dateStr(occurrence.date), escapeHtml(describeRecurrence(item)), "#7a7369")
  );

  return `
<div style="background:#f7f5f2;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:10px;border:1px solid #e2ddd6;">
    <tr>
      <td style="padding:24px 28px 4px;">
        <div style="font-size:18px;font-weight:700;color:#2b2926;">Client Compliance Tracker</div>
        <div style="font-size:13px;color:#7a7369;margin-top:2px;">${todayStr}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 20px;font-size:14px;color:#2b2926;">
        <strong>${overdue.length}</strong> overdue &middot; <strong>${dueSoon.length}</strong> due soon
      </td>
    </tr>
    ${overdueSection}
    ${dueSoonSection}
    <tr>
      <td style="padding:16px 28px;border-top:1px solid #e2ddd6;">
        <a href="${APP_URL}" style="display:inline-block;background:#3d5a80;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px;font-weight:600;">Open Client Compliance Tracker</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;font-size:12px;color:#7a7369;">
        Automated daily digest. This address does not accept replies.
      </td>
    </tr>
  </table>
</div>`;
}

export { buildPlainText, buildHtml };

// Only run when executed directly (`node scripts/send-digest.mjs`), not when imported for testing.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
