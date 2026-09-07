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

// One-time admin op, same reasoning as enableTotpMfa above: Storage buckets have no CORS
// config by default, which is invisible for how the app normally touches Storage (uploads via
// the SDK, downloads via window.open -- neither is a cross-origin fetch()) but breaks the one
// place that needs the actual bytes client-side: stampSignature in pdf-sign.js fetches the
// original PDF via a plain fetch() to sign it, which the browser blocks without this. No
// gsutil/gcloud available to run `gsutil cors set` locally, so this does the equivalent via the
// Admin SDK's own Storage client, which needs no separate tooling or credentials.
exports.setStorageCors = onCall(async (request) => {
  if (!request.auth || request.auth.token.approved !== true) {
    throw new HttpsError("permission-denied", "Approved staff only.");
  }
  try {
    await getStorage().bucket().setMetadata({
      cors: [
        {
          origin: [
            "https://bowling-green-bookkeeping.web.app",
            "https://client-compliance-tracker.web.app",
            "https://client-compliance-tracker.firebaseapp.com",
          ],
          method: ["GET"],
          maxAgeSeconds: 3600,
        },
      ],
    });
    return { ok: true };
  } catch (err) {
    logger.error("setStorageCors failed", err);
    throw new HttpsError("internal", String(err.message || err));
  }
});

// Forms library: staff picks a blank template and one or more clients (see the "Forms Library"
// modal in public/js/app.js / public/js/forms.js). Runs server-side rather than having the
// browser download the template and re-upload it per client -- for a bulk send to many clients
// that's N round trips of file bytes through the client's own connection for no reason, when the
// Admin SDK can copy the object bucket-to-bucket directly. Each copy becomes that client's own
// Storage object (see storage.rules) and their own sentForms doc, which is what
// functions.sendFormEmail below actually reacts to.
exports.sendFormToClients = onCall(async (request) => {
  if (!request.auth || request.auth.token.approved !== true) {
    throw new HttpsError("permission-denied", "Approved staff only.");
  }
  const { templateId, clientIds, note } = request.data || {};
  if (!templateId || !Array.isArray(clientIds) || clientIds.length === 0) {
    throw new HttpsError("invalid-argument", "templateId and at least one clientId are required.");
  }

  const templateSnap = await db.collection("formTemplates").doc(templateId).get();
  if (!templateSnap.exists) {
    throw new HttpsError("not-found", "That template no longer exists.");
  }
  const template = templateSnap.data();
  const bucket = getStorage().bucket();
  const sentBy = request.auth.token.email;

  let sentCount = 0;
  for (const clientId of clientIds) {
    const sentFormRef = db.collection("clients").doc(clientId).collection("sentForms").doc();
    const destPath = `clients/${clientId}/sentForms/${sentFormRef.id}/blank.pdf`;
    await bucket.file(template.storagePath).copy(bucket.file(destPath));
    await sentFormRef.set({
      templateId,
      templateName: template.name,
      storagePath: destPath,
      note: note || null,
      status: "sent",
      sentBy,
      sentAt: FieldValue.serverTimestamp(),
      returnedAt: null,
      returnedDocId: null,
      returnedVia: null,
    });
    sentCount++;
  }
  return { sentCount };
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
      await sendEmail({
        to: invite.recipientEmail,
        subject: `Set up your ${APP_NAME} client portal`,
        text: buildText(clientName, link),
        html: buildHtml(clientName, link),
      });
      await event.data.ref.update({ emailSentAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error("Failed to send client invite email", err);
      await event.data.ref.update({ emailError: String(err.message || err) });
    }
  }
);

async function sendEmail({ to, subject, text, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY.value()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: MAIL_FROM.value(), to: [to], subject, text, html }),
  });
  if (!res.ok) {
    throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
  }
}

// Looks up the Firebase Auth email for the client-role account tied to a clientId, if that
// account has been created yet (self-service signup via clientInvites -- see firestore.rules'
// users/{uid} create rule). Returns null if no such account exists yet (invite not accepted).
async function getClientAccountEmail(clientId) {
  const usersSnap = await db
    .collection("users")
    .where("role", "==", "client")
    .where("clientId", "==", clientId)
    .limit(1)
    .get();
  if (usersSnap.empty) return null;
  const userRecord = await getAuth().getUser(usersSnap.docs[0].id);
  return userRecord.email || null;
}

async function getStaffEmails() {
  const allowlistDoc = await db.collection("settings").doc("allowlist").get();
  return allowlistDoc.exists ? allowlistDoc.data().emails || [] : [];
}

// Client-facing: staff sent a new engagement letter -- let the client know there's something to
// sign. Silently does nothing if their account doesn't exist yet (invite not accepted), same as
// sendClientInvite's own "nothing to send" cases above.
exports.sendLetterEmail = onDocumentCreated(
  { document: "clients/{clientId}/letters/{letterId}", secrets: [RESEND_API_KEY, MAIL_FROM] },
  async (event) => {
    const { clientId, letterId } = event.params;
    const letter = event.data.data();
    const email = await getClientAccountEmail(clientId);
    if (!email) return;

    try {
      await sendEmail({
        to: email,
        subject: `A document is ready for your signature -- ${APP_NAME}`,
        text: `${APP_NAME} sent you a document to review and sign: "${letter.title}".\n\nSign in to your Client Hub to review and sign it: ${APP_URL}/`,
        html: buildLetterHtml("A document is ready for your signature", `<strong>${escapeHtml(letter.title)}</strong> is ready for you to review and sign in your Client Hub.`, "Review and sign"),
      });
    } catch (err) {
      logger.error(`Failed to send letter-ready email for ${clientId}/${letterId}`, err);
    }
  }
);

// Staff-facing: a client just signed -- let every approved staff member know, same recipient
// list computeAndSetClaims uses to decide who counts as staff.
exports.notifyStaffOnLetterSigned = onDocumentWritten(
  { document: "clients/{clientId}/letters/{letterId}", secrets: [RESEND_API_KEY, MAIL_FROM] },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.status !== "signed" || before?.status === "signed") return;

    const { clientId } = event.params;
    const [staffEmails, clientSnap] = await Promise.all([
      getStaffEmails(),
      db.collection("clients").doc(clientId).get(),
    ]);
    if (staffEmails.length === 0) return;
    const clientName = clientSnap.exists ? clientSnap.data().name : "A client";

    try {
      await Promise.all(
        staffEmails.map((to) =>
          sendEmail({
            to,
            subject: `${clientName} signed "${after.title}" -- ${APP_NAME}`,
            text: `${clientName} just signed "${after.title}".\n\nOpen it in the Client Hub: ${APP_URL}/`,
            html: buildLetterHtml("Letter signed", `<strong>${escapeHtml(clientName)}</strong> just signed <strong>${escapeHtml(after.title)}</strong>.`, "Open Client Hub"),
          })
        )
      );
    } catch (err) {
      logger.error(`Failed to notify staff for signed letter ${clientId}`, err);
    }
  }
);

// Client-facing: staff sent a new form (see exports.sendFormToClients above, which is what
// actually creates this doc). Silently does nothing if their account doesn't exist yet, same as
// sendLetterEmail's own "nothing to send" case.
exports.sendFormEmail = onDocumentCreated(
  { document: "clients/{clientId}/sentForms/{sentFormId}", secrets: [RESEND_API_KEY, MAIL_FROM] },
  async (event) => {
    const { clientId, sentFormId } = event.params;
    const form = event.data.data();
    const email = await getClientAccountEmail(clientId);
    if (!email) return;

    const noteText = form.note ? `${form.note}\n\n` : "";
    const noteHtml = form.note ? `${escapeHtml(form.note)}<br><br>` : "";

    try {
      await sendEmail({
        to: email,
        subject: `A form is ready for you -- ${APP_NAME}`,
        text: `${noteText}"${form.templateName}" is ready for you to download and fill out in your Client Hub.\n\nSign in to your Client Hub: ${APP_URL}/`,
        html: buildLetterHtml("A form is ready for you", `${noteHtml}<strong>${escapeHtml(form.templateName)}</strong> is ready for you to download and fill out in your Client Hub.`, "Open Client Hub"),
      });
    } catch (err) {
      logger.error(`Failed to send form-ready email for ${clientId}/${sentFormId}`, err);
    }
  }
);

// Staff-facing: a client's form just came back -- either they uploaded the completed copy
// themselves (returnedVia "upload") or staff marked it received by some other means, like an
// emailed-back copy (returnedVia "manual"). Same staff recipient list/pattern as
// notifyStaffOnLetterSigned above.
exports.notifyStaffOnFormReturned = onDocumentWritten(
  { document: "clients/{clientId}/sentForms/{sentFormId}", secrets: [RESEND_API_KEY, MAIL_FROM] },
  async (event) => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    if (!after || after.status !== "returned" || before?.status === "returned") return;

    const { clientId } = event.params;
    const [staffEmails, clientSnap] = await Promise.all([
      getStaffEmails(),
      db.collection("clients").doc(clientId).get(),
    ]);
    if (staffEmails.length === 0) return;
    const clientName = clientSnap.exists ? clientSnap.data().name : "A client";

    try {
      await Promise.all(
        staffEmails.map((to) =>
          sendEmail({
            to,
            subject: `${clientName} returned "${after.templateName}" -- ${APP_NAME}`,
            text: `${clientName} just returned "${after.templateName}".\n\nOpen it in the Client Hub: ${APP_URL}/`,
            html: buildLetterHtml("Form returned", `<strong>${escapeHtml(clientName)}</strong> just returned <strong>${escapeHtml(after.templateName)}</strong>.`, "Open Client Hub"),
          })
        )
      );
    } catch (err) {
      logger.error(`Failed to notify staff for returned form ${clientId}`, err);
    }
  }
);

function buildLetterHtml(heading, bodyHtml, buttonLabel) {
  return `
<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
  <div style="background: #2563eb; color: #ffffff; padding: 20px 24px; border-radius: 10px 10px 0 0;">
    <strong style="font-size: 16px;">${APP_NAME}</strong>
  </div>
  <div style="border: 1px solid #e2e5eb; border-top: none; border-radius: 0 0 10px 10px; padding: 24px;">
    <h1 style="font-size: 18px; margin: 0 0 12px; color: #1a1d23;">${heading}</h1>
    <p style="font-size: 14px; line-height: 1.6; color: #444444; margin: 0 0 20px;">${bodyHtml}</p>
    <div style="text-align: center; margin: 0 0 20px;">
      <a href="${APP_URL}/" style="background: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; display: inline-block;">
        ${buttonLabel}
      </a>
    </div>
  </div>
</div>`;
}

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
