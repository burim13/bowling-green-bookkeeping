// Sends the "set up your Client Hub account" email when staff generates an invite with a
// recipient email attached (see openInviteClientModal in public/js/app.js). Reuses the exact
// same Resend integration pattern as scripts/send-digest.mjs -- same API, same secret-based
// credential handling, just triggered by a Firestore write instead of a cron schedule.
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

initializeApp();
setGlobalOptions({ maxInstances: 5 });

const db = getFirestore();

// ---- custom claims sync (role/clientId/approved -> Firebase Auth token) --------------------
//
// storage.rules originally tried to read /users/{uid} and /settings/allowlist directly via
// firestore.get(), the documented pattern for Storage rules needing Firestore data. That
// reliably failed for this project (confirmed by bisection: even the simplest single-field
// cross-service read was denied for every account, staff included) -- root cause undetermined,
// but custom claims sidestep it entirely, since request.auth.token.* is available in Storage
// rules natively, no cross-service call at all. Firestore rules are unaffected by any of this
// -- they use plain same-service get(), which always worked.
//
// Whenever a /users/{uid} doc changes, recompute that one user's claims. Whenever
// /settings/allowlist changes, every staff/admin user's "approved" claim could be stale, so
// resync all of them.

async function computeAndSetClaims(uid) {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) return;
  const data = userDoc.data();

  let approved = false;
  if (data.role === "staff" || data.role === "admin") {
    const allowlistDoc = await db.collection("settings").doc("allowlist").get();
    const emails = allowlistDoc.exists ? allowlistDoc.data().emails || [] : [];
    const userRecord = await getAuth().getUser(uid);
    approved = emails.includes(userRecord.email);
  }

  await getAuth().setCustomUserClaims(uid, {
    role: data.role || null,
    clientId: data.clientId || null,
    approved,
  });
}

exports.syncUserClaimsOnUserWrite = onDocumentWritten("users/{uid}", async (event) => {
  if (!event.data.after.exists) return; // doc deleted -- nothing to sync
  await computeAndSetClaims(event.params.uid);
});

exports.syncUserClaimsOnAllowlistWrite = onDocumentWritten("settings/allowlist", async () => {
  const staffSnap = await db.collection("users").where("role", "in", ["staff", "admin"]).get();
  await Promise.all(staffSnap.docs.map((d) => computeAndSetClaims(d.id)));
});

// ---- document "reviewed" status -> Storage object metadata --------------------------------
//
// A client is allowed to delete a document they uploaded, but only before staff has reviewed
// it (see storage.rules). Same cross-service problem as above rules out storage.rules reading
// the Firestore doc directly to check `reviewed` -- so instead, whenever a document's reviewed
// field changes, this stamps the SAME value onto the Storage object's own custom metadata,
// which storage.rules can read natively via resource.metadata with no cross-service call.
exports.syncDocumentReviewedMetadata = onDocumentWritten(
  "clients/{clientId}/documents/{docId}",
  async (event) => {
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after || !after.storagePath) return;
    try {
      await getStorage().bucket().file(after.storagePath).setMetadata({
        metadata: { reviewed: String(!!after.reviewed) },
      });
    } catch (err) {
      // Most likely the object was already deleted (e.g. staff deleted it directly) --
      // nothing left to stamp metadata onto, not worth failing the function over.
      logger.warn(`Could not sync reviewed metadata for ${after.storagePath}`, err);
    }
  }
);

// ---- one-time admin op: enable TOTP as an MFA provider ------------------------------------
//
// There is no Firebase Console or Cloud Console UI toggle for TOTP MFA (only SMS shows up in
// either console) -- Google only exposes it via the Admin SDK / Identity Platform REST API.
// This function exists solely to flip that project-level config once; delete it right after
// confirming it worked. It's a callable function (not onRequest) specifically so it never
// needs a public/unauthenticated invoker -- the Firebase client SDK attaches the caller's own
// ID token automatically, verified server-side below, same trust boundary as isApproved() in
// firestore.rules/storage.rules.
const { onCall, HttpsError } = require("firebase-functions/v2/https");

exports.enableTotpMfa = onCall(async (request) => {
  if (!request.auth || request.auth.token.approved !== true) {
    throw new HttpsError("permission-denied", "Approved staff only.");
  }
  try {
    const result = await getAuth().projectConfigManager().updateProjectConfig({
      multiFactorConfig: {
        providerConfigs: [{ state: "ENABLED", totpProviderConfig: { adjacentIntervals: 5 } }],
      },
    });
    return { ok: true, multiFactorConfig: result.multiFactorConfig };
  } catch (err) {
    logger.error("enableTotpMfa failed", err);
    throw new HttpsError("internal", String(err.message || err));
  }
});

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
// e.g. "Bowling Green Bookkeeping & Taxes <onboarding@resend.dev>" if you haven't verified a
// custom sending domain in Resend yet -- see README for how to set this.
const MAIL_FROM = defineSecret("MAIL_FROM");

const APP_URL = "https://bowling-green-bookkeeping.web.app";
const APP_NAME = "Bowling Green Bookkeeping & Taxes";

exports.sendClientInvite = onDocumentCreated(
  { document: "clientInvites/{token}", secrets: [RESEND_API_KEY, MAIL_FROM] },
  async (event) => {
    const token = event.params.token;
    const invite = event.data.data();
    // Staff can also generate a link-only invite (no email typed in) -- nothing to send then.
    if (!invite.recipientEmail) return;

    const clientSnap = await db.collection("clients").doc(invite.clientId).get();
    const clientName = clientSnap.exists ? clientSnap.data().name : "your account";
    const link = `${APP_URL}/invite.html?token=${token}&clientId=${invite.clientId}`;

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY.value()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: MAIL_FROM.value(),
          to: [invite.recipientEmail],
          subject: `Set up your ${APP_NAME} client portal`,
          text: buildText(clientName, link),
          html: buildHtml(clientName, link),
        }),
      });

      if (!res.ok) {
        throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
      }
      await event.data.ref.update({ emailSentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error("Failed to send client invite email", err);
      await event.data.ref.update({ emailError: String(err.message || err) });
    }
  }
);

function buildText(clientName, link) {
  return `${APP_NAME} has invited you to their Client Hub.

You're receiving this as the contact for ${clientName}. Your accountant has set up a secure
online portal where you can upload tax documents -- W-2s, 1099s, receipts, and more -- instead
of emailing or mailing them.

Set up your account: ${link}

This link works once. If you weren't expecting this email, you can safely ignore it -- no
account is created unless that link is actually used.`;
}

function buildHtml(clientName, link) {
  return `
<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
  <div style="background: #2563eb; color: #ffffff; padding: 20px 24px; border-radius: 10px 10px 0 0;">
    <strong style="font-size: 16px;">${APP_NAME}</strong>
  </div>
  <div style="border: 1px solid #e2e5eb; border-top: none; border-radius: 0 0 10px 10px; padding: 24px;">
    <h1 style="font-size: 18px; margin: 0 0 12px; color: #1a1d23;">You've been invited to the Client Hub</h1>
    <p style="font-size: 14px; line-height: 1.6; color: #444444; margin: 0 0 12px;">
      You're receiving this as the contact for <strong>${escapeHtml(clientName)}</strong>. Your
      accountant has set up a secure online portal where you can upload tax documents -- W-2s,
      1099s, receipts, and more -- instead of emailing or mailing them.
    </p>
    <p style="font-size: 14px; line-height: 1.6; color: #444444; margin: 0 0 20px;">
      Click below to create your account -- you'll choose your own email and password.
    </p>
    <div style="text-align: center; margin: 0 0 20px;">
      <a href="${link}" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block;">
        Set up your account
      </a>
    </div>
    <p style="font-size: 12px; color: #888888; line-height: 1.5; margin: 0;">
      This link works once. If you weren't expecting this email, you can safely ignore it -- no
      account is created unless that link is actually used.
    </p>
  </div>
</div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
