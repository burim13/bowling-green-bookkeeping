// Client Hub invite links: a staff-generated, single-use token tying a self-service signup to
// exactly one client. See firestore.rules' clientInvites match block for the actual security
// boundary -- this module just creates the token doc; the invite page (public/invite.html) does
// the signup itself. If recipientEmail is given, functions/index.js's Firestore trigger emails
// the link automatically; if not, this is a link-only invite for staff to share themselves.
import { doc, setDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js?v=1788752726623";

export async function createClientInvite(clientId, recipientEmail) {
  const token = crypto.randomUUID();
  await setDoc(doc(db, "clientInvites", token), {
    clientId,
    used: false,
    recipientEmail: recipientEmail || null,
    createdAt: serverTimestamp(),
  });
  return token;
}

// Live status of one invite -- lets the UI show whether functions/index.js's sendClientInvite
// trigger actually delivered the email (emailSentAt) or failed (emailError), instead of staff
// only finding out when the client says they never got anything.
export function subscribeToInviteStatus(token, callback) {
  return onSnapshot(doc(db, "clientInvites", token), (snap) => {
    if (snap.exists()) callback(snap.data());
  });
}
