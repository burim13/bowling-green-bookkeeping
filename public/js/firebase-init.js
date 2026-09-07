// Central place that loads the Firebase SDK (via CDN, no build step) and initializes the
// app/auth/firestore instances every other module imports.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";
import { firebaseConfig, isFirebaseConfigured, recaptchaSiteKey } from "./firebase-config.js?v=1788759669832";

export { isFirebaseConfigured };

let app, auth, db, storage;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  // Attaches a reCAPTCHA v3-backed token to every Firestore/Storage/Functions request so those
  // resources can eventually be locked to "only my app's traffic" (see App Check console) --
  // harmless while every product there is still set to Unenforced, which is the state this
  // stays in until that's flipped deliberately, once real traffic is confirmed passing.
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
  auth = getAuth(app);
  setPersistence(auth, browserLocalPersistence);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, db, storage };
