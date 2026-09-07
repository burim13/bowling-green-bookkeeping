// Client Hub document intake: Storage upload + the Firestore metadata doc that tracks it.
// Storage path and Firestore doc share the same auto-generated ID so the two always line up.
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { db, storage } from "./firebase-init.js?v=1788749152210";

export const DOC_TYPES = [
  { id: "w2", label: "W-2" },
  { id: "1099", label: "1099" },
  { id: "receipts", label: "Receipts" },
  { id: "other", label: "Other" },
];

export function docTypeLabel(id) {
  return DOC_TYPES.find((t) => t.id === id)?.label || "Other";
}

function sanitizeFileName(name) {
  return name.replace(/[/\\]/g, "-");
}

export function subscribeToDocuments(clientId, callback, onError) {
  const q = query(collection(db, "clients", clientId, "documents"), orderBy("uploadedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Resolves with the new document's ID once the file is fully uploaded and its metadata doc is
// written. onProgress(percent) fires repeatedly while the upload is in flight.
export function uploadDocument(clientId, file, docType, uploadedBy, onProgress) {
  return new Promise((resolve, reject) => {
    const docRef = doc(collection(db, "clients", clientId, "documents"));
    const fileName = sanitizeFileName(file.name);
    const storagePath = `clients/${clientId}/documents/${docRef.id}/${fileName}`;
    const task = uploadBytesResumable(ref(storage, storagePath), file, {
      contentType: file.type || "application/octet-stream",
    });

    task.on(
      "state_changed",
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      () => {
        setDoc(docRef, {
          fileName,
          storagePath,
          docType,
          sizeBytes: file.size,
          uploadedBy,
          uploadedAt: serverTimestamp(),
          reviewed: false,
        })
          .then(() => resolve(docRef.id))
          .catch(reject);
      }
    );
  });
}

export function setDocumentReviewed(clientId, docId, reviewed) {
  return updateDoc(doc(db, "clients", clientId, "documents", docId), { reviewed });
}

export function getDocumentDownloadURL(storagePath) {
  return getDownloadURL(ref(storage, storagePath));
}
