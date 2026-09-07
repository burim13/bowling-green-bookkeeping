// Translates Firebase Auth error codes into generic, brand-neutral messages for surfaces an
// unauthenticated visitor can reach (sign-in, MFA challenge/enrollment, client signup) -- the
// raw err.message Firebase SDKs produce is prefixed "Firebase: ..." and effectively announces
// what backend platform this runs on to anyone who fumbles a login, which is free reconnaissance
// for an attacker. Every catch block on those screens should show friendlyAuthError(err), never
// err.message directly. Post-auth staff/client operational errors (failed uploads, saves, etc.)
// aren't in scope here -- those only ever reach someone already signed in with legitimate access.
export function friendlyAuthError(err) {
  // The real error (with the Firebase-branded message) still goes to the console -- only the
  // on-screen text is scrubbed, so debugging isn't lost, just kept out of the visible UI.
  console.error(err);
  switch (err?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      // Deliberately the same message for both "wrong password" and "no such account" -- telling
      // them apart lets an attacker enumerate which emails have accounts.
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled. Contact your administrator.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error -- check your connection and try again.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 8 characters).";
    case "auth/email-already-in-use":
      return "An account with that email already exists.";
    case "auth/invalid-verification-code":
      return "That code is incorrect. Please try again.";
    case "auth/code-expired":
      return "That code has expired. Please try again.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't available right now. Contact your administrator.";
    default:
      return "Something went wrong. Please try again or contact your administrator.";
  }
}
