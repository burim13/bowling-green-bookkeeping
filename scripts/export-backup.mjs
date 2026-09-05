// Walks every collection/document/subcollection in Firestore and writes a single JSON
// snapshot to backups/YYYY-MM-DD.json. Generic over the schema (no hardcoded collection
// names) so it keeps working if the data model grows.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initAdmin, admin } from "./firebase-admin-init.mjs";

initAdmin();
const db = admin.firestore();

function serializeValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serializeValue(v);
    return out;
  }
  return value;
}

async function exportCollection(collectionRef) {
  const snap = await collectionRef.get();
  const result = {};
  for (const doc of snap.docs) {
    const subcollections = await doc.ref.listCollections();
    const entry = serializeValue(doc.data());
    if (subcollections.length > 0) {
      entry._subcollections = {};
      for (const sub of subcollections) {
        entry._subcollections[sub.id] = await exportCollection(sub);
      }
    }
    result[doc.id] = entry;
  }
  return result;
}

async function main() {
  const topLevelCollections = await db.listCollections();
  const backup = {};
  for (const coll of topLevelCollections) {
    backup[coll.id] = await exportCollection(coll);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(outDir, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `${dateStr}.json`);
  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2));
  console.log(`Wrote backups/${dateStr}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
