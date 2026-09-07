// Self-contained logic for invite.html -- deliberately separate from app.js/auth.js, which all
// assume an existing account with a role. This page's whole job is the one-time step before
// that's true: turn a valid invite token into a brand new role:"client" account.
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "./firebase-init.js?v=1788795760256";
import { friendlyAuthError } from "./auth-errors.js?v=1788795760256";

function qs(id) {
  return document.getElementById(id);
}

function showError(message) {
  const el = qs("invite-error");
  el.textContent = message;
  el.hidden = false;
}

function init() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const clientId = params.get("clientId");

  if (!isFirebaseConfigured) {
    qs("config-warning").hidden = false;
    qs("auth-screen").hidden = true;
    return;
  }

  if (!token || !clientId) {
    qs("invite-invalid").hidden = false;
    qs("invite-form").hidden = true;
    return;
  }

  qs("invite-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    qs("invite-error").hidden = true;

    const email = qs("invite-email").value.trim();
    const password = qs("invite-password").value;
    const confirmPassword = qs("invite-password-confirm").value;
    if (password !== confirmPassword) {
      showError("Passwords don't match.");
      return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      // This write is the actual security checkpoint -- firestore.rules only accepts it if
      // `token` names a real, unused /clientInvites doc whose clientId matches what we're
      // writing here. A forged or already-used token makes this fail with permission-denied,
      // regardless of what this page sends.
      await setDoc(doc(db, "users", cred.user.uid), {
        role: "client",
        clientId,
        inviteToken: token,
        email,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "clientInvites", token), { used: true });

      // functions/index.js's syncUserClaimsOnUserWrite trigger sets role/clientId as custom
      // claims on this account, which Storage rules need -- but it's async and won't have run
      // yet at this exact instant. Give it a moment, then force a fresh ID token so the very
      // first thing this client does (likely uploading a document) doesn't fail.
      submitBtn.textContent = "Setting up your account…";
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await cred.user.getIdToken(true);
      window.location.href = "index.html";
    } catch (err) {
      if (err.code === "permission-denied") {
        qs("invite-invalid").hidden = false;
        qs("invite-form").hidden = true;
      } else if (err.code === "auth/email-already-in-use") {
        showError("An account with that email already exists. Try signing in instead.");
      } else {
        showError(friendlyAuthError(err));
      }
      submitBtn.disabled = false;
    }
  });
}

init();
