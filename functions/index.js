// Sends the "set up your Client Hub account" email when staff generates an invite with a
// recipient email attached (see openInviteClientModal in public/js/app.js). Reuses the exact
// same Resend integration pattern as scripts/send-digest.mjs -- same API, same secret-based
// credential handling, just triggered by a Firestore write instead of a cron schedule.
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({ maxInstances: 5 });

const db = getFirestore();

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
