// Shared Admin SDK bootstrap for the backup and seed scripts.
// Expects the full service account JSON key in the FIREBASE_SERVICE_ACCOUNT_KEY env var
// (set as a GitHub Actions secret in CI, or in your local shell for one-off runs).
import admin from "firebase-admin";

export function initAdmin() {
  if (admin.apps.length) return admin.app();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Export the service account JSON key into that " +
        "env var before running this script (see README.md)."
    );
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return admin.app();
}

export { admin };
