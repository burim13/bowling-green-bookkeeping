// Forms library: staff upload a blank PDF template once (e.g. a blank Schedule C worksheet),
// keep it on file, and send it to one or more clients whenever needed. Two Firestore pieces:
// the shared `formTemplates` collection (the library itself, firm-wide) and each client's own
// `sentForms` subcollection (one doc per send, mirrors letters.js's shape). Sending is a Cloud
// Function (functions/index.js's sendFormToClients) rather than a client-side upload, since it
// needs to copy the template's bytes into N per-client Storage objects server-side -- see that
// function's own comment for why.
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { db, storage, functions } from "./firebase-init.js?v=1788809593179";

// ---- the library (firm-wide, staff-only) -------------------------------------------------

export function subscribeToFormTemplates(callback, onError) {
  const q = query(collection(db, "formTemplates"), orderBy("uploadedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function uploadFormTemplate(file, name, uploadedBy) {
  const templateRef = doc(collection(db, "formTemplates"));
  const storagePath = `formTemplates/${templateRef.id}/${file.name}`;
  await uploadBytes(ref(storage, storagePath), file, { contentType: "application/pdf" });
  await setDoc(templateRef, {
    name,
    storagePath,
    fileName: file.name,
    uploadedBy,
    uploadedAt: serverTimestamp(),
  });
  return templateRef.id;
}

export async function deleteFormTemplate(templateId, storagePath) {
  await deleteDoc(doc(db, "formTemplates", templateId));
  await deleteObject(ref(storage, storagePath)).catch(() => {});
}

export function getFormDownloadURL(storagePath) {
  return getDownloadURL(ref(storage, storagePath));
}

// Server-side fan-out (copies the template into each client's own Storage object and creates
// their sentForms doc) -- see the Cloud Function itself for why this isn't done client-side.
export async function sendFormToClients(templateId, clientIds, note) {
  const call = httpsCallable(functions, "sendFormToClients");
  const result = await call({ templateId, clientIds, note: note || null });
  return result.data;
}

// ---- per-client sent-form records ----------------------------------------------------------

export function subscribeToSentForms(clientId, callback, onError) {
  const q = query(collection(db, "clients", clientId, "sentForms"), orderBy("sentAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Client-initiated: called right after their own upload succeeds (see the Forms tab's upload
// handler in app.js). firestore.rules only allows this exact one-way "sent" -> "returned"
// transition, touching only these fields -- same shape as letters.js's signLetter.
export async function markFormReturned(clientId, sentFormId, docId) {
  await updateDoc(doc(db, "clients", clientId, "sentForms", sentFormId), {
    status: "returned",
    returnedAt: serverTimestamp(),
    returnedDocId: docId,
    returnedVia: "upload",
  });
}

// Staff-initiated, for the case where a client emailed the completed form back instead of
// uploading it -- the app has no way to know that happened on its own, so staff flips this by
// hand to keep the "awaiting return" count accurate.
export async function markFormReturnedManually(clientId, sentFormId) {
  await updateDoc(doc(db, "clients", clientId, "sentForms", sentFormId), {
    status: "returned",
    returnedAt: serverTimestamp(),
    returnedVia: "manual",
  });
}
