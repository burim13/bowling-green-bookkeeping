// Adds a couple of fake clients with sample items, so the UI has something to show right
// after deploy. Safe to run more than once -- it always creates new client docs rather than
// overwriting, so re-running just adds duplicates; delete them from the UI if that happens.
// Run locally once: FIREBASE_SERVICE_ACCOUNT_KEY=... npm run seed
import { initAdmin, admin } from "./firebase-admin-init.mjs";

initAdmin();
const db = admin.firestore();

const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n) => {
  const d = new Date(today);
  d.setMonth(d.getMonth() - n);
  return iso(d);
};

const SAMPLE_CLIENTS = [
  {
    name: "Riverside Coffee Roasters LLC",
    notes: "Sample client -- safe to delete. Single-member LLC, monthly bookkeeping client.",
    items: [
      { category: "Monthly Bookkeeping Reconciliation", startDate: monthsAgo(2), recurrenceType: "monthly" },
      { category: "Payroll", startDate: monthsAgo(2), recurrenceType: "monthly", recurrenceDayOfMonth: 15 },
      { category: "Sales Tax Filing", startDate: monthsAgo(1), recurrenceType: "quarterly" },
      { category: "BOI (Beneficial Ownership Information) Report", startDate: iso(today), recurrenceType: "annually" },
    ],
  },
  {
    name: "Harper & Vance Consulting Inc.",
    notes: "Sample client -- safe to delete. S-corp, quarterly estimates + annual corporate return.",
    items: [
      { category: "Quarterly Estimated Taxes", startDate: monthsAgo(3), recurrenceType: "quarterly" },
      { category: "Corporate Return (Form 1120/1120-S)", startDate: monthsAgo(6), recurrenceType: "annually" },
      { category: "W-2 / W-3 Filing", startDate: monthsAgo(8), recurrenceType: "annually" },
    ],
  },
];

async function main() {
  for (const client of SAMPLE_CLIENTS) {
    const clientRef = await db.collection("clients").add({
      name: client.name,
      notes: client.notes,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    for (const item of client.items) {
      await clientRef.collection("items").add({
        category: item.category,
        customLabel: null,
        startDate: item.startDate,
        recurrenceType: item.recurrenceType,
        recurrenceInterval: item.recurrenceType === "custom" ? 1 : null,
        recurrenceDayOfMonth: item.recurrenceDayOfMonth || null,
        recurrenceCustomRule: null,
      });
    }
    console.log(`Seeded client "${client.name}" (${clientRef.id}) with ${client.items.length} items.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
