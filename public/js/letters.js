// Client Hub engagement letters: staff sends a PDF for signature, the client signs it in the
// browser (see pdf-sign.js for the actual stamping), and the signed, stamped PDF becomes the
// record of record. Firestore doc ID and both Storage objects (original.pdf / signed.pdf) share
// the same ID so they always line up -- same pattern as documents.js.
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
import { db, storage } from "./firebase-init.js?v=1788760294461";

export function subscribeToLetters(clientId, callback, onError) {
  const q = query(collection(db, "clients", clientId, "letters"), orderBy("sentAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

export async function sendLetter(clientId, file, title, sentBy) {
  const letterRef = doc(collection(db, "clients", clientId, "letters"));
  const storagePath = `clients/${clientId}/letters/${letterRef.id}/original.pdf`;
  await uploadBytes(ref(storage, storagePath), file, { contentType: "application/pdf" });
  await setDoc(letterRef, {
    title,
    storagePath,
    status: "sent",
    sentBy,
    sentAt: serverTimestamp(),
    signedAt: null,
    signerName: null,
    signMethod: null,
    signerIp: null,
    signedPdfPath: null,
  });
  return letterRef.id;
}

// Client-initiated: uploads the already-stamped signed PDF (see pdf-sign.js) and flips the
// letter to status "signed". firestore.rules only allows the "sent" -> "signed" transition once,
// touching only these fields, and storage.rules only lets the client *create* signed.pdf, never
// overwrite/delete it afterward -- so this can't be replayed to re-sign or tamper with a letter.
export async function signLetter(clientId, letterId, { signedPdfBytes, signerName, signMethod, signerIp }) {
  const signedPdfPath = `clients/${clientId}/letters/${letterId}/signed.pdf`;
  await uploadBytes(ref(storage, signedPdfPath), signedPdfBytes, { contentType: "application/pdf" });
  await updateDoc(doc(db, "clients", clientId, "letters", letterId), {
    status: "signed",
    signedAt: serverTimestamp(),
    signerName,
    signMethod,
    signerIp: signerIp || null,
    signedPdfPath,
  });
}

// Staff-only, and only while unsigned (firestore.rules/storage.rules enforce this too) -- once a
// letter is signed it's an audit record, not something staff can clean up.
export async function deleteLetter(clientId, letterId, storagePath) {
  await deleteDoc(doc(db, "clients", clientId, "letters", letterId));
  await deleteObject(ref(storage, storagePath)).catch(() => {});
}

export function getLetterDownloadURL(storagePath) {
  return getDownloadURL(ref(storage, storagePath));
}
