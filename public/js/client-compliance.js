// Read-only compliance data for the Client Hub's own "Compliance" tab. Staff's data.js uses
// collectionGroup() queries across every client at once -- a client-role account has no
// Firestore permission for that (see firestore.rules), only for their own client's items/
// completions subcollections directly. So this builds the same state shape list-view.js and
// clientCompletionStats expect ({ clients, items, completions } Maps), just scoped to one client.
import { collection, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js?v=1788799307726";

export function subscribeToOwnCompliance(clientId, clientName, callback) {
  const state = {
    clients: new Map([[clientId, { id: clientId, name: clientName }]]),
    items: new Map(),
    completions: new Map(),
  };

  return onSnapshot(collection(db, "clients", clientId, "items"), async (snap) => {
    state.items.clear();
    snap.forEach((d) => state.items.set(d.id, { id: d.id, clientId, ...d.data() }));

    // Completions aren't live-updated within this same listener (a second, nested onSnapshot
    // per item would work but adds real lifecycle complexity for a screen a client checks
    // occasionally, not one that needs to reflect a staff edit within seconds) -- refetched
    // once whenever the item list itself changes, which is enough to stay reasonably current.
    state.completions.clear();
    await Promise.all(
      [...state.items.keys()].map(async (itemId) => {
        const compSnap = await getDocs(collection(db, "clients", clientId, "items", itemId, "completions"));
        if (compSnap.empty) return;
        const map = new Map();
        compSnap.forEach((c) => map.set(c.id, c.data()));
        state.completions.set(itemId, map);
      })
    );

    callback(state);
  });
}
