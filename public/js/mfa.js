// Staff-only TOTP multi-factor authentication. Requires "Multi-factor authentication" enabled
// with the TOTP provider in Firebase Console -> Authentication -> Sign-in method -> Advanced --
// every call here throws auth/operation-not-allowed until that's done.
//
// Firebase's TOTP MFA has no built-in recovery-code mechanism (unlike GitHub/Google's backup
// codes). If someone loses their authenticator device, recovery is manual: in the Firebase
// console, Authentication -> Users -> their row -> remove the enrolled second factor, then they
// re-enroll on next sign-in via the same mandatory gate everyone else went through.
import {
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { auth } from "./firebase-init.js?v=1788800213033";

const APP_NAME = "Bowling Green Bookkeeping & Taxes";

export function isMfaEnrolled(user) {
  return multiFactor(user).enrolledFactors.length > 0;
}

// Starts enrollment for the currently signed-in user. Returns the secret (needed again to
// finish enrollment) and a QR code URL to render.
export async function startMfaEnrollment() {
  const user = auth.currentUser;
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const qrCodeUrl = secret.generateQrCodeUrl(user.email, APP_NAME);
  return { secret, qrCodeUrl, secretKey: secret.secretKey };
}

// Completes enrollment given the secret from startMfaEnrollment() and the 6-digit code the
// user just read off their authenticator app.
export function finishMfaEnrollment(secret, code) {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  return multiFactor(auth.currentUser).enroll(assertion, "Authenticator app");
}

// Call from the catch block around signInWithPassword when err.code is
// "auth/multi-factor-auth-required" -- returns a resolver the sign-in challenge screen needs.
export function getResolver(error) {
  return getMultiFactorResolver(auth, error);
}

// Completes a challenged sign-in with the 6-digit code. Resolves to the same kind of
// UserCredential a normal sign-in would -- caller still needs to run auth.js's afterSignIn().
export function completeMfaSignIn(resolver, code) {
  const enrolledFactorUid = resolver.hints[0].uid;
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(enrolledFactorUid, code);
  return resolver.resolveSignIn(assertion);
}
