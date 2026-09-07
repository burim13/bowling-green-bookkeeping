// Central place that loads the Firebase SDK (via CDN, no build step) and initializes the
// app/auth/firestore instances every other module imports.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=1788749152210";

export { isFirebaseConfigured };

let app, auth, db, storage;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, db, storage };
