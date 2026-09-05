# Client Compliance Tracker

An internal calendar/checklist for a bookkeeping & tax practice to track recurring compliance
deadlines (payroll, sales tax, quarterly estimates, annual filings, etc.) per client.

No SSNs, account numbers, or dollar amounts are stored here -- only client names, task/category
labels, and dates.

**Stack:** static HTML/CSS/JS (no build step) on GitHub Pages, talking directly to Firebase
Authentication + Cloud Firestore. A GitHub Actions workflow backs up the database to JSON daily.

---

## 1. One-time setup

### 1a. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Add project**. Name it anything (e.g.
   "client-compliance-tracker"). You can decline Google Analytics -- it's not needed.
2. In the left sidebar, go to **Build -> Authentication -> Get started**.
   - Under **Sign-in method**, enable **Email/Password**.
   - Also enable **Email link (passwordless sign-in)** if you want that option (it's under the
     same Email/Password provider's settings, as a second toggle).
3. In the left sidebar, go to **Build -> Firestore Database -> Create database**. Choose
   **Production mode** and any nearby region. (Production mode just means "start locked down" --
   we deploy our own rules below, so this is fine.)
4. **Before deploying rules**, create the access allowlist -- skipping this locks everyone
   (including you) out the moment the rules below go live:
   - Firestore console -> **Data** tab -> **Start collection** -> collection ID `settings`.
   - Document ID: `allowlist`. Add one field: `emails` (type **array**), with a single string
     entry: your own email address, exactly as you'll sign in with (lowercase).
   - Save.
5. Deploy the security rules in [`firestore.rules`](firestore.rules):
   - Easiest path: in the Firestore console, open the **Rules** tab, paste in the contents of
     `firestore.rules` from this repo, and click **Publish**.
   - Or, if you have the Firebase CLI (`npm install -g firebase-tools`, then `firebase login` and
     `firebase use --add` to select this project once), run `firebase deploy --only firestore:rules`
     from this folder any time the rules file changes.
6. Register a web app: **Project settings (gear icon) -> General -> Your apps -> Add app -> Web**
   (the `</>` icon). Give it any nickname. You do **not** need Firebase Hosting.
7. Copy the `firebaseConfig` object it shows you (apiKey, authDomain, projectId, etc.) into
   [`js/firebase-config.js`](js/firebase-config.js), replacing the `REPLACE_WITH_...` placeholders.
   This config is public/safe to commit -- it is not a secret. Access control is enforced entirely
   by Firestore Security Rules, not by hiding this file.
8. Create your own login: **Authentication -> Users -> Add user** in the console, using the same
   email you put in the allowlist above. (There's no self-service "Create account" button in the
   app on purpose -- see "Restricting who can sign in" below.)

### 1b. Deploy to GitHub Pages

1. Push this repo to GitHub (public repo -- GitHub Pages is free only for public repos on a
   personal account).
2. In the repo, go to **Settings -> Pages**. Under **Build and deployment**, set **Source** to
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
3. GitHub will give you a URL like `https://yourusername.github.io/client-compliance-tracker/`.

**GitHub Pages caches every file for up to 10 minutes per CDN edge, independent of anyone's
browser cache.** Deploying a change to `index.html`, anything in `css/`, or anything in `js/`
without accounting for this can mean visitors silently keep running old code for a while after a
push -- confusing since it looks identical to a real bug. Run `npm run bump-version` before
committing any such change; it stamps every internal `<script>`/`<link>` reference and
`import ... from "./x.js"` with the same fresh `?v=<timestamp>`, forcing a real fetch on the next
deploy instead of relying on a stale cached copy. (It only touches local file references --
CDN-hosted imports like the Firebase SDK are untouched.)

### 1c. Authorize the GitHub Pages domain in Firebase

This step is easy to miss and causes sign-in to silently fail:

1. Firebase Console -> **Authentication -> Settings -> Authorized domains**.
2. Click **Add domain** and add `yourusername.github.io` (just the domain, no path).

`localhost` is included by default, so local testing works without this step.

### 1d. Set up the backup workflow's secret

The backup workflow needs a Firebase **service account key** (server-side credential -- never put
this in front-end code):

1. Firebase Console -> **Project settings -> Service accounts -> Generate new private key**. This
   downloads a JSON file.
2. In GitHub: repo **Settings -> Secrets and variables -> Actions -> New repository secret**.
   - Name: `FIREBASE_SERVICE_ACCOUNT_KEY`
   - Value: paste the **entire contents** of the downloaded JSON file.
3. Delete the downloaded JSON file from your computer once it's saved as a secret (or keep it
   somewhere private -- never commit it to the repo; `.gitignore` already excludes
   `serviceAccountKey.json` as a precaution).

The workflow ([`.github/workflows/backup.yml`](.github/workflows/backup.yml)) runs daily and can
also be triggered manually from the **Actions** tab (or from the app's "Export to GitHub" button,
which links there).

### 1e. Seed sample data (optional but recommended)

To try the app with a couple of fake clients right after deploy, run the seed script once from
your own machine (requires Node.js and the same service account key from step 1d):

```bash
npm install
FIREBASE_SERVICE_ACCOUNT_KEY='<paste the full JSON key here>' npm run seed
```

On Windows PowerShell:

```powershell
$env:FIREBASE_SERVICE_ACCOUNT_KEY = Get-Content -Raw serviceAccountKey.json
npm run seed
```

This adds two sample clients ("Riverside Coffee Roasters LLC" and "Harper & Vance Consulting
Inc.") with a handful of items. Delete them from the UI whenever you're ready for real data.

### 1f. Set up the daily digest email

A separate workflow ([`.github/workflows/digest.yml`](.github/workflows/digest.yml)) emails a
summary of overdue items + anything due soon, once a day. It's skipped automatically on days with
nothing to report. "Due soon" isn't a fixed window -- how far ahead an item shows up depends on how
often it recurs, since a monthly task doesn't need weeks of notice the way an annual filing does:
monthly/custom items get a 7-day lookahead, quarterly items 14 days, annual items 30 days. It uses
[Resend](https://resend.com) to send mail:

1. Sign up at https://resend.com (free tier: 3,000 emails/month, no credit card).
2. In the Resend dashboard, go to **API Keys -> Create API Key**. Copy the key (starts with `re_`).
3. Add two more GitHub Actions secrets (same place as step 1d: repo **Settings -> Secrets and
   variables -> Actions**):
   - `RESEND_API_KEY` -- the key from step 2.
   - `DIGEST_TO_EMAIL` -- the email address that should receive the digest (e.g. your own).

That's it -- no domain verification needed. The digest sends from Resend's shared
`onboarding@resend.dev` address, which works for any recipient without extra setup. If you'd
rather send from your own domain later, verify it in Resend's dashboard and set a
`DIGEST_FROM_EMAIL` secret (e.g. `"Client Compliance Tracker <alerts@yourdomain.com>"`) -- the
workflow already reads that variable if it's present.

The default schedule is 13:00 UTC (~8am US Central). To change the time, edit the `cron` line in
`.github/workflows/digest.yml`. You can also trigger it manually any time from the **Actions** tab.

---

## 2. Restricting who can sign in

This app has no public sign-up -- there's no "Create account" button, and every account is added
by you, one at a time. Two things are checked before anyone can use the app for real:

1. **A Firebase Auth login exists for them** (Firebase Console -> **Authentication -> Users -> Add
   user**, with an email + temporary password -- tell them to change it, or send a password reset).
2. **Their email is in the allowlist** (Firestore console -> **Data** tab -> `settings` ->
   `allowlist` -> the `emails` array -- add their address, exactly as they'll sign in with).

Both are needed. Someone with a login but no allowlist entry can reach the sign-in screen and even
"successfully" sign in, but every read/write in the app fails immediately -- they'll see errors,
not real data. Someone in the allowlist without a login can't sign in at all. This split exists
because Firebase's free (Spark) plan has no built-in way to block self-service account creation
outright (that needs a paid-tier "blocking function") -- so instead, the allowlist in
[`firestore.rules`](firestore.rules) is the actual boundary that decides who can touch any data,
regardless of how many Firebase Auth accounts happen to exist.

To remove someone's access, delete their email from the `allowlist` array -- their login still
exists in Firebase Auth, but every action in the app will fail for them from that point on. Delete
the Auth user too (**Authentication -> Users**) if you want the login itself gone as well.

### Roles

Each user gets a `users/{uid}` document with a `role` field, either `"admin"` or `"staff"`. Every
new account starts as `staff` -- this is enforced in `firestore.rules` itself (new user docs are
only accepted with `role: "staff"`), so a user can never grant themselves admin by signing up or
by editing their own doc.

The only thing role currently gates is **deleting a client outright** -- that's the one action
that's irreversible and cascades (removes all its items and completion history), so it's
admin-only, enforced in [`firestore.rules`](firestore.rules) (not just hidden in the UI). Staff can
still do everything else: add/edit/remove items, mark things complete, add clients, manage
categories.

To promote someone to admin later, edit their `role` field to `"admin"` directly in the Firestore
console (**Firestore Database -> Data -> users -> their document**).

---

## 3. Firebase Spark (free) plan quotas

This app runs entirely on Firebase's free "Spark" plan. Spark has **daily/monthly hard caps** --
once hit, reads/writes fail until the quota resets (or you upgrade):

| Resource | Spark plan limit |
|---|---|
| Firestore reads | 50,000 / day |
| Firestore writes | 20,000 / day |
| Firestore stored data | 1 GB |
| Auth monthly active users | 50,000 / month |

A single practice with a handful of staff checking a calendar throughout the day will use a tiny
fraction of this. If it's ever exceeded, the fix is to enable the pay-as-you-go **Blaze** plan in
the Firebase console (Blaze still has a generous free tier -- you only pay for usage past it).

---

## 4. How the recurrence/period logic works

Each item stores a `startDate` and a `recurrenceType` (`monthly`, `quarterly`, `annually`, or
`custom`). Rather than pre-generating rows for every future month/quarter/year, the app computes
occurrences on the fly from these fields (see [`js/recurrence.js`](js/recurrence.js)):

- Every recurrence type is really "repeat every **N** months, on day **D**":
  `monthly` = every 1 month, `quarterly` = every 3 months, `annually` = every 12 months, `custom`
  = every `recurrenceInterval` months. `D` defaults to the day-of-month of `startDate`, or the
  explicit `recurrenceDayOfMonth` if set.
- For any given calendar month, the app checks whether that month is a multiple of `N` months
  after `startDate`'s month. If so, that item is "due" that month, on day `D` (clamped to the last
  day of the month for short months, e.g. day 31 in February becomes the 28th/29th).
- Each occurrence has a **period key** -- `"2026-09"` for monthly/custom, `"2026-Q3"` for
  quarterly, `"2026"` for annually -- which is what completions are keyed by.

Marking an item complete writes a document to
`clients/{clientId}/items/{itemId}/completions/{periodKey}` with `completedOn` and
`completedBy` (the signed-in user's email). Unchecking it deletes that document. Because the due
date is always recomputed from `startDate` + recurrence rules rather than stored per-period,
nothing needs to be manually created when a new month/quarter/year starts -- the next unchecked
instance simply appears on its own.

### Changing an item's recurrence mid-life

Editing an item's category/date/day-of-month fields is a plain correction -- it applies to the
whole item, past and future, same as always. But if the *frequency itself* genuinely changed
partway through (e.g. a client moved from monthly to quarterly bookkeeping starting a given
month), editing the item also offers a **"Recurrence change effective from"** date. Filling that
in snapshots whatever the recurrence was *before* this edit into the item's `priorRule` field, and
stores the given date as `currentRuleEffectiveFrom` -- occurrences before that month keep using the
old cadence, occurrences from that month on use whatever you just entered. Leaving it blank clears
any existing split, back to one rule for the item's entire life. The edit form shows the current
history summary (e.g. "Quarterly (was Monthly through Aug 2026)") whenever a split exists.

### Archiving a client

Archiving (via the "Archive client" button in a client's edit modal) sets `archived: true` on the
client document -- it's a plain field, not a deletion. Archived clients disappear from the sidebar,
the calendar, and the list view by default (their history and data are untouched), with a "Show N
archived clients" toggle at the bottom of the sidebar to bring them back into view when needed
(e.g. to look something up, or to restore them via the same button). Each client row in the
sidebar also shows a small `current/total` badge based on whether its items' most recent due
occurrence is complete -- it's a quick at-a-glance signal, not a data field of its own.

---

## 5. Restoring from a GitHub JSON backup

Each backup is a single JSON file in [`backups/`](backups/), named by date (e.g.
`backups/2026-09-04.json`), shaped like:

```json
{
  "clients": {
    "<clientId>": {
      "name": "...",
      "notes": "...",
      "createdAt": "2026-09-01T12:00:00.000Z",
      "_subcollections": {
        "items": {
          "<itemId>": {
            "category": "...",
            "...": "...",
            "_subcollections": { "completions": { "<periodKey>": { "...": "..." } } }
          }
        }
      }
    }
  },
  "settings": { "categories": { "names": [ "..." ] } },
  "users": { "<uid>": { "...": "..." } }
}
```

To restore a collection (or the whole database) from one of these files, write a small one-off
Node script alongside `scripts/export-backup.mjs` that does the reverse walk: for each top-level
key, `db.collection(key).doc(id).set(data)` (stripping `_subcollections` before the `set`, then
recursing into each subcollection the same way). This is intentionally left as a manual step
rather than an automated "restore" button, since restoring is rare and destructive enough that you
want to review the JSON first.

If you only need to recover one client or one item rather than the whole database, it's often
faster to just open the JSON file, find that document, and re-create it by hand through the app's
UI.

---

## 6. Why "Export to GitHub" opens a GitHub page instead of exporting directly

The backup process needs the Firebase **service account key** -- a server-side admin credential
that must never be shipped to the browser (this repo, including its JavaScript, is publicly
readable on GitHub Pages). So the front end cannot trigger a backup by itself. Instead, the
"Export to GitHub" button links to the workflow's **Actions** page, where you click **"Run
workflow"** while signed in to GitHub. The daily scheduled run covers routine backups; the manual
button is for taking a snapshot right before a big change.

---

## 7. Project structure

```
index.html                   Single-page app shell
css/styles.css                All styling
js/firebase-config.js         Your Firebase web config (edit this)
js/firebase-init.js           Initializes the Firebase SDK
js/auth.js                    Sign in/up/out, email-link sign-in
js/data.js                    Firestore CRUD + live sync (onSnapshot)
js/recurrence.js              Due-date/period-key computation
js/calendar-view.js           Month grid rendering
js/list-view.js               Grouped checklist rendering
js/colors.js                  Stable color assignment for calendar coding
js/app.js                     Wiring: view state, modals, event handlers
firestore.rules                Security rules (deploy via console or Firebase CLI)
firebase.json                  Points the Firebase CLI at firestore.rules
scripts/export-backup.mjs      Used by the GitHub Actions backup workflow
scripts/seed-data.mjs          One-time sample data seeder
scripts/send-digest.mjs        Used by the GitHub Actions digest workflow
scripts/bump-cache-version.mjs Cache-busts index.html/js/css references (see below)
.github/workflows/backup.yml   Daily + manual backup workflow
.github/workflows/digest.yml   Daily overdue/due-this-week email digest
backups/                       JSON snapshots land here
```

## 8. Non-goals for v1

- No SMS/push notifications (email digest only -- see section 1f).
- No fine-grained roles/permissions yet (see "Roles" above).
- No storage of sensitive PII, account numbers, or dollar figures.
