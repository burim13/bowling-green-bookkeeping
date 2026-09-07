// Client Hub invite links: a staff-generated, single-use token tying a self-service signup to
// exactly one client. See firestore.rules' clientInvites match block for the actual security
// boundary -- this module just creates the token doc; the invite page (public/invite.html) does
// the signup itself.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase-init.js?v=1788749658461";

export async function createClientInvite(clientId) {
  const token = crypto.randomUUID();
  await setDoc(doc(db, "clientInvites", token), {
    clientId,
    used: false,
    createdAt: serverTimestamp(),
  });
  return token;
}
