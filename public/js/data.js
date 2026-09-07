// Firestore data layer: live-synced in-memory store (via onSnapshot) + CRUD helpers.
// Everything talks to Firestore directly through the SDK; access control is enforced by
// firestore.rules, not by anything in this file.
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js?v=1788751373741";

// ---- live store ----------------------------------------------------------

const state = {
  clients: new Map(), // clientId -> { id, name, notes, createdAt }
  items: new Map(), // itemId -> { id, clientId, category, customLabel, startDate, recurrenceType, recurrenceInterval, recurrenceDayOfMonth }
  completions: new Map(), // itemId -> Map(periodKey -> { completedOn, completedBy })
  categories: [],
  currentUserRole: null, // "admin" | "staff" | null, for the signed-in user
  // Whether each live listener has received its first snapshot yet -- lets the UI show a
  // loading state instead of momentarily flashing "no clients yet" while data is still en route.
  loaded: { clients: false, items: false, completions: false, categories: false },
};

export function isFullyLoaded() {
  return Object.values(state.loaded).every(Boolean);
}

const dataListeners = new Set();
const saveStatusListeners = new Set();
let unsubscribers = [];

function notifyData() {
  for (const cb of dataListeners) cb(state);
}

function setSaveStatus(status, message) {
  for (const cb of saveStatusListeners) cb({ status, message });
}

export function subscribeToData(callback) {
  dataListeners.add(callback);
  callback(state);
  return () => dataListeners.delete(callback);
}

export function subscribeToSaveStatus(callback) {
  saveStatusListeners.add(callback);
  return () => saveStatusListeners.delete(callback);
}

export function startSync() {
  stopSync();
  state.loaded.clients = false;
  state.loaded.items = false;
  state.loaded.completions = false;
  state.loaded.categories = false;

  unsubscribers.push(
    onSnapshot(
      doc(db, "users", auth.currentUser.uid),
      (snap) => {
        state.currentUserRole = snap.exists() ? snap.data().role : null;
        notifyData();
      },
      (err) => setSaveStatus("error", err.message)
    )
  );

  unsubscribers.push(
    onSnapshot(
      collection(db, "clients"),
      (snap) => {
        state.clients.clear();
        snap.forEach((d) => state.clients.set(d.id, { id: d.id, ...d.data() }));
        state.loaded.clients = true;
        notifyData();
      },
      (err) => setSaveStatus("error", err.message)
    )
  );

  unsubscribers.push(
    onSnapshot(
      collectionGroup(db, "items"),
      (snap) => {
        state.items.clear();
        snap.forEach((d) => {
          const clientId = d.ref.parent.parent.id;
          state.items.set(d.id, { id: d.id, clientId, ...d.data() });
        });
        state.loaded.items = true;
        notifyData();
      },
      (err) => setSaveStatus("error", err.message)
    )
  );

  unsubscribers.push(
    onSnapshot(
      collectionGroup(db, "completions"),
      (snap) => {
        state.completions.clear();
        snap.forEach((d) => {
          const itemId = d.ref.parent.parent.id;
          if (!state.completions.has(itemId)) state.completions.set(itemId, new Map());
          state.completions.get(itemId).set(d.id, d.data());
        });
        state.loaded.completions = true;
        notifyData();
      },
      (err) => setSaveStatus("error", err.message)
    )
  );

  unsubscribers.push(
    onSnapshot(
      doc(db, "settings", "categories"),
      (snap) => {
        state.categories = snap.exists() ? snap.data().names || [] : [];
        state.loaded.categories = true;
        notifyData();
      },
      (err) => setSaveStatus("error", err.message)
    )
  );
}

export function stopSync() {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
}

async function withSaveStatus(fn) {
  setSaveStatus("saving");
  try {
    const result = await fn();
    setSaveStatus("saved");
    return result;
  } catch (err) {
    setSaveStatus("error", err.message);
    throw err;
  }
}

// ---- categories ------------------------------------------------------------

export function seedCategoriesIfMissing(defaultNames) {
  return withSaveStatus(async () => {
    const ref = doc(db, "settings", "categories");
    const existing = await getDocs(collection(db, "settings"));
    const alreadyHas = existing.docs.some((d) => d.id === "categories");
    if (!alreadyHas) {
      await setDoc(ref, { names: defaultNames });
    }
  });
}

export function saveCategories(names) {
  return withSaveStatus(() => setDoc(doc(db, "settings", "categories"), { names }));
}

// ---- clients -----------------------------------------------------------

// One-time (not live) fetch of a single client record -- used by the Client Hub screen, which
// a client-role account sees instead of the staff app-shell and so never gets this from the
// collection-wide onSnapshot in startSync().
export async function getClientRecord(clientId) {
  const snap = await getDoc(doc(db, "clients", clientId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function addClient(name, notes) {
  return withSaveStatus(() =>
    addDoc(collection(db, "clients"), { name, notes: notes || "", createdAt: serverTimestamp() })
  );
}

export function updateClient(clientId, { name, notes }) {
  return withSaveStatus(() => updateDoc(doc(db, "clients", clientId), { name, notes: notes || "" }));
}

export function setClientArchived(clientId, archived) {
  return withSaveStatus(() => updateDoc(doc(db, "clients", clientId), { archived }));
}

export async function deleteClientCascade(clientId) {
  return withSaveStatus(async () => {
    const itemsSnap = await getDocs(collection(db, "clients", clientId, "items"));
    for (const itemDoc of itemsSnap.docs) {
      const completionsSnap = await getDocs(
        collection(db, "clients", clientId, "items", itemDoc.id, "completions")
      );
      const batch = writeBatch(db);
      completionsSnap.forEach((c) => batch.delete(c.ref));
      batch.delete(itemDoc.ref);
      await batch.commit();
    }
    await deleteDoc(doc(db, "clients", clientId));
  });
}

// ---- items ---------------------------------------------------------------

export function addItem(clientId, itemData) {
  return withSaveStatus(() => addDoc(collection(db, "clients", clientId, "items"), itemData));
}

export function updateItem(clientId, itemId, itemData) {
  return withSaveStatus(() =>
    updateDoc(doc(db, "clients", clientId, "items", itemId), itemData)
  );
}

export async function deleteItem(clientId, itemId) {
  return withSaveStatus(async () => {
    const completionsSnap = await getDocs(
      collection(db, "clients", clientId, "items", itemId, "completions")
    );
    const batch = writeBatch(db);
    completionsSnap.forEach((c) => batch.delete(c.ref));
    batch.delete(doc(db, "clients", clientId, "items", itemId));
    await batch.commit();
  });
}

// ---- completions -----------------------------------------------------------

export function markComplete(clientId, itemId, periodKey) {
  return withSaveStatus(() =>
    setDoc(doc(db, "clients", clientId, "items", itemId, "completions", periodKey), {
      periodKey,
      completedOn: serverTimestamp(),
      completedBy: auth.currentUser ? auth.currentUser.email : "unknown",
    })
  );
}

export function unmarkComplete(clientId, itemId, periodKey) {
  return withSaveStatus(() =>
    deleteDoc(doc(db, "clients", clientId, "items", itemId, "completions", periodKey))
  );
}

export function isComplete(itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return !!(forItem && forItem.has(periodKey));
}

export function getCompletion(itemId, periodKey) {
  const forItem = state.completions.get(itemId);
  return forItem ? forItem.get(periodKey) : null;
}
