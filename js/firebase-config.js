// Firebase web config for this project.
// Get these values from: Firebase Console -> Project settings -> General -> Your apps -> Web app -> SDK setup and configuration.
// This config is safe to expose in client-side code -- it is NOT a secret. Access control is enforced by Firestore
// Security Rules (see firestore.rules), not by hiding this object.
export const firebaseConfig = {
  apiKey: "REPLACE_WITH_API_KEY",
  authDomain: "REPLACE_WITH_PROJECT_ID.firebaseapp.com",
  projectId: "REPLACE_WITH_PROJECT_ID",
  storageBucket: "REPLACE_WITH_PROJECT_ID.appspot.com",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID",
};

// Set automatically to false until the placeholders above are filled in, so the app can show a
// friendly setup message instead of a confusing Firebase error on first load.
export const isFirebaseConfigured = !firebaseConfig.apiKey.startsWith("REPLACE_WITH");

// Used to build the "Run backup workflow" link on the export button.
// Set this to your GitHub repo once it exists, e.g. "yourusername/client-compliance-tracker".
export const githubRepoSlug = "REPLACE_WITH_OWNER/REPLACE_WITH_REPO";
