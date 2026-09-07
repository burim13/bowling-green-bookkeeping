import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js?v=1788800213033";

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithPassword(email, password) {
  // If this account has MFA enrolled, Firebase throws auth/multi-factor-auth-required here
  // *before* completing sign-in -- afterSignIn() below never runs for that attempt. The caller
  // (see wireAuthForms in app.js) catches that specific error and drives the code-entry
  // challenge instead; afterSignIn() runs once that challenge resolves, via
  // mfa.js's completeMfaSignIn.
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await afterSignIn(cred.user);
}

export async function afterSignIn(user) {
  await ensureUserDoc();
  // Picks up whatever role/clientId/approved custom claims functions/index.js's
  // syncUserClaims* triggers have set since this account's last login -- Storage rules read
  // these directly (see storage.rules), so a stale cached token could show outdated access.
  await user.getIdToken(true);
}

export async function signOutUser() {
  await signOut(auth);
}

// One-time (not live) lookup of the signed-in user's own profile, used right after auth
// resolves to decide which shell to show *before* anything else runs -- in particular, before
// the staff-only data listeners in data.js start, which would otherwise throw permission
// errors for a client-role account.
export async function getOwnProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

// Lets a staff/admin account set a real display name instead of the "displayName defaults to
// email" fallback ensureUserDoc below writes at signup -- the header shows this (first word
// only) + role instead of the raw email once it's set. Firestore rules already allow an
// approved user to update any field on their own /users/{uid} doc except role, so nothing new
// needed there.
export async function updateOwnDisplayName(name) {
  const user = auth.currentUser;
  if (!user) return;
  await updateDoc(doc(db, "users", user.uid), { displayName: name });
}

async function ensureUserDoc() {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  // Every new account starts as staff -- Security Rules only accept role: "staff" on
  // create, so this can't be a client-side decision (a user could otherwise just claim
  // "admin" for themselves). Promoting someone to admin is a manual step in the Firebase
  // console (see README), which uses the Admin SDK and so bypasses this restriction.
  await setDoc(ref, {
    displayName: user.displayName || user.email,
    role: "staff",
    createdAt: serverTimestamp(),
  });
}
