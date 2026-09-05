import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  isSignInWithEmailLink,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

const EMAIL_LINK_STORAGE_KEY = "cct_email_for_signin";

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithPassword(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
  await ensureUserDoc();
}

// Used the very first time an account is created (owner today, staff later via the same flow
// if you'd rather not add them from the Firebase console).
export async function registerWithPassword(email, password) {
  await createUserWithEmailAndPassword(auth, email, password);
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

async function ensureUserDoc() {
  const user = auth.currentUser;
  if (!user) return;
  const ref = doc(db, "users", user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  // The very first person to sign in (an empty users collection) becomes admin
  // automatically; everyone after that starts as staff. Security Rules use this role
  // to gate the one action that's admin-only: deleting a client outright.
  const usersSnap = await getDocs(collection(db, "users"));
  const role = usersSnap.empty ? "admin" : "staff";

  await setDoc(ref, {
    displayName: user.displayName || user.email,
    role,
    createdAt: serverTimestamp(),
  });
}
