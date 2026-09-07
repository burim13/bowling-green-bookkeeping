// Firebase web config for this project.
// Get these values from: Firebase Console -> Project settings -> General -> Your apps -> Web app -> SDK setup and configuration.
// This config is safe to expose in client-side code -- it is NOT a secret. Access control is enforced by Firestore
// Security Rules (see firestore.rules), not by hiding this object.
export const firebaseConfig = {
  apiKey: "AIzaSyBEjJhGnhJlm0UuZ_SDd93F_h-0Fp8i7_k",
  authDomain: "client-compliance-tracker.firebaseapp.com",
  projectId: "client-compliance-tracker",
  storageBucket: "client-compliance-tracker.firebasestorage.app",
  messagingSenderId: "736199739850",
  appId: "1:736199739850:web:df72a22f5f17821e90a733",
};

// Set automatically to false until the placeholders above are filled in, so the app can show a
// friendly setup message instead of a confusing Firebase error on first load.
export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith("REPLACE_WITH");

// App Check reCAPTCHA ENTERPRISE key ID (Google Cloud Console -> Security -> reCAPTCHA
// Enterprise, score-based, mirrored into Firebase Console -> Build -> App Check -> Apps -> this
// web app). Public by design, like firebaseConfig above -- it identifies the site, it doesn't
// grant access to anything by itself. Must be paired with ReCaptchaEnterpriseProvider in
// firebase-init.js, NOT ReCaptchaV3Provider -- those are different products with different site
// key registries; a classic v3 key here (or vice versa) fails token exchange with a 400.
export const recaptchaSiteKey = "6LehSa4tAAAAANaRiyLOUrts1mPf80oZb4Ahz-8L";

// Used to build the "Run backup workflow" link on the export button.
export const githubRepoSlug = "burim13/client-compliance-tracker";
