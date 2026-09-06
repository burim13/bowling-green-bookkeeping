import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js?v=1788736189548";

const EMAIL_LINK_STORAGE_KEY = "cct_email_for_signin";

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithPassword(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc();
}

export async function sendEmailLink(email) {
  const actionCodeSettings = {
    url: window.location.href.split("?")[0],
    handleCodeInApp: true,
  };
  await sendSignInLinkToEmail(auth, email, actionCodeSettings);
  window.localStorage.setItem(EMAIL_LINK_STORAGE_KEY, email);
}

// Call on every page load; it's a no-op unless the URL is actually a sign-in link.
export async function completeEmailLinkSignInIfPresent() {
  if (!isSignInWithEmailLink(auth, window.location.href)) return false;

  let email = window.localStorage.getItem(EMAIL_LINK_STORAGE_KEY);
  if (!email) {
    email = window.prompt("Confirm your email address to finish signing in:");
  }
  if (!email) return false;

  await signInWithEmailLink(auth, email, window.location.href);
  window.localStorage.removeItem(EMAIL_LINK_STORAGE_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
  await ensureUserDoc();
  return true;
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
