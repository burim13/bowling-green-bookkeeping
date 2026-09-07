import { isFirebaseConfigured, auth } from "./firebase-init.js?v=1788790192341";
import { escapeHtml } from "./html-safety.js?v=1788790192341";
import {
  watchAuthState,
  signInWithPassword,
  signOutUser,
  getOwnProfile,
  afterSignIn,
} from "./auth.js?v=1788790192341";
import {
  isMfaEnrolled,
  startMfaEnrollment,
  finishMfaEnrollment,
  getResolver,
  completeMfaSignIn,
} from "./mfa.js?v=1788790192341";
import {
  startSync,
  stopSync,
  subscribeToData,
  subscribeToSaveStatus,
  seedCategoriesIfMissing,
  saveCategories,
  addClient,
  updateClient,
  setClientArchived,
  deleteClientCascade,
  addItem,
  updateItem,
  deleteItem,
  markComplete,
  unmarkComplete,
  isFullyLoaded,
  getClientRecord,
} from "./data.js?v=1788790192341";
import { renderCalendar } from "./calendar-view.js?v=1788790192341";
import { renderList } from "./list-view.js?v=1788790192341";
import { describeRecurrence, describeRecurrenceHistory, getLastDueOccurrence, toISODate } from "./recurrence.js?v=1788790192341";
import { colorFor, tintFor } from "./colors.js?v=1788790192341";
import { githubRepoSlug } from "./firebase-config.js?v=1788790192341";
import {
  DOC_TYPES,
  docTypeLabel,
  subscribeToDocuments,
  uploadDocument,
  setDocumentReviewed,
  getDocumentDownloadURL,
  deleteDocument,
} from "./documents.js?v=1788790192341";
import { createClientInvite, subscribeToInviteStatus } from "./invites.js?v=1788790192341";
import { subscribeToOwnCompliance } from "./client-compliance.js?v=1788790192341";
import { subscribeToLetters, sendLetter, signLetter, deleteLetter, getLetterDownloadURL } from "./letters.js?v=1788790192341";
import {
  stampSignature,
  stampFields,
  renderTypedSignature,
  wireSignatureCanvas,
  fetchPublicIp,
  loadPdfDocument,
  renderPdfPageToCanvas,
  FIELD_DEFAULT_SIZE,
} from "./pdf-sign.js?v=1788790192341";
import { iconEdit, iconTrash, iconPlus, iconPlusLarge, iconCheck, iconTag, iconUpload, iconLogout, iconCalendar, iconListView, iconFolder, iconFolderLarge, iconHome, iconChevronRight, iconUsers, iconAlertTriangle, iconSignature, iconFile, iconUploadLarge, iconDownload, iconClock } from "./icons.js?v=1788790192341";

const DEFAULT_CATEGORIES = [
  "Payroll",
  "Sales Tax Filing",
  "Quarterly Estimated Taxes",
  "1099-NEC / 1099-MISC Filing",
  "W-2 / W-3 Filing",
  "Annual Report / State Franchise Filing",
  "Partnership Return (Form 1065)",
  "Corporate Return (Form 1120/1120-S)",
  "Personal Return (Form 1040)",
  "Monthly Bookkeeping Reconciliation",
  "BOI (Beneficial Ownership Information) Report",
  "Extension Deadline",
];

const els = {};
let latestState = {
  clients: new Map(),
  items: new Map(),
  completions: new Map(),
  categories: [],
  currentUserRole: null,
};
let viewState = {
  view: localStorage.getItem("cct_view") || "overview",
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  colorMode: localStorage.getItem("cct_colormode") || "client",
  clientFilter: null,
  categoryFilter: null,
  clientSearch: "",
  showArchived: false,
};

let currentListRows = []; // rows currently rendered (unfiltered by completion) by the list view
let mfaResolver = null; // pending sign-in challenge, set when signInWithPassword throws auth/multi-factor-auth-required
let mfaEnrollSecret = null; // pending enrollment secret from startMfaEnrollment(), needed again by finishMfaEnrollment()
let mfaEnrollUser = null; // the user object mid-enrollment -- watchAuthState hasn't shown a shell for them yet

function qs(id) {
  return document.getElementById(id);
}

function init() {
  els.authScreen = qs("auth-screen");
  els.appShell = qs("app-shell");
  els.configWarning = qs("config-warning");
  els.saveStatus = qs("save-status");
  els.viewContainer = qs("view-container");
  els.clientList = qs("client-list");
  els.clientSearch = qs("client-search");
  els.viewToggleOverview = qs("view-toggle-overview");
  els.viewToggleCalendar = qs("view-toggle-calendar");
  els.viewToggleList = qs("view-toggle-list");
  els.viewToggleClientHub = qs("view-toggle-clienthub");
  els.listFilterClient = qs("list-filter-client");
  els.filterCategory = qs("filter-category");
  els.categoryFilterWrap = qs("category-filter-wrap");
  els.bulkAddItemBtn = qs("bulk-add-item-btn");
  els.exportBtn = qs("export-btn");
  els.markAllCompleteBtn = qs("mark-all-complete-btn");
  els.userBadge = qs("user-badge");
  els.clientHubScreen = qs("client-hub-screen");
  els.clientHubName = qs("client-hub-name");
  els.mfaChallengeScreen = qs("mfa-challenge-screen");
  els.mfaEnrollScreen = qs("mfa-enroll-screen");

  if (!isFirebaseConfigured) {
    els.configWarning.hidden = false;
    els.authScreen.hidden = true;
    return;
  }

  // Icon + label markup so these can collapse to icon-only on narrow screens (see .btn-header
  // in styles.css) without duplicating the icon set into static HTML.
  qs("manage-categories-btn").innerHTML = iconTag;
  qs("export-btn").innerHTML = `<span class="btn-header-icon">${iconUpload}</span><span class="btn-header-label">Export to GitHub</span>`;
  qs("sign-out-btn").innerHTML = `<span class="btn-header-icon">${iconLogout}</span><span class="btn-header-label">Sign out</span>`;
  qs("view-toggle-overview").innerHTML = iconHome;
  qs("view-toggle-calendar").innerHTML = iconCalendar;
  qs("view-toggle-list").innerHTML = iconListView;
  qs("view-toggle-clienthub").innerHTML = iconFolder;

  wireAuthForms();
  wireMfaScreens();
  wireToolbar();
  wireClientHubScreen();

  watchAuthState(async (user) => {
    if (!user) {
      els.authScreen.hidden = false;
      els.appShell.hidden = true;
      els.clientHubScreen.hidden = true;
      stopSync();
      clientDocsUnsub?.();
      clientDocsUnsub = null;
      clientLettersUnsub?.();
      clientLettersUnsub = null;
      clientComplianceUnsub?.();
      clientComplianceUnsub = null;
      staffDocsUnsub?.();
      staffDocsUnsub = null;
      return;
    }

    // Look up role BEFORE showing either shell -- a client-role account must never trigger the
    // staff-only listeners in startSync(), which it has no Firestore permission to read.
    let profile;
    try {
      profile = await getOwnProfile();
    } catch (err) {
      showAuthError(err.message);
      await signOutUser();
      return;
    }
    if (!profile) {
      showAuthError("No profile found for this account. Contact your accountant.");
      await signOutUser();
      return;
    }

    els.authScreen.hidden = true;
    if (profile.role === "client") {
      els.appShell.hidden = true;
      stopSync();
      await showClientHub(profile);
    } else if (isMfaEnrolled(user)) {
      showStaffShell(user);
    } else {
      // Every staff/admin account must enroll TOTP MFA before it can see any client data --
      // gate the app shell behind enrollment instead of just nudging toward it.
      await startMfaEnrollmentFlow(user);
    }
  });

  subscribeToData((state) => {
    latestState = state;
    renderClientList();
    renderCategoryFilterOptions();
    renderCurrentView();
  });

  subscribeToSaveStatus(({ status, message }) => {
    els.saveStatus.className = `save-status save-status-${status}`;
    if (status === "saving") {
      els.saveStatus.textContent = "Saving…";
    } else if (status === "saved") {
      els.saveStatus.innerHTML = `${iconCheck} Saved`;
      setTimeout(() => {
        if (els.saveStatus.classList.contains("save-status-saved")) els.saveStatus.innerHTML = "";
      }, 2000);
    } else {
      els.saveStatus.textContent = `Error: ${message}`;
    }
  });

  setActiveView(viewState.view);
}

// ---- auth screen -----------------------------------------------------------

function wireAuthForms() {
  qs("password-signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = qs("auth-email").value.trim();
    const password = qs("auth-password").value;
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      if (err.code === "auth/multi-factor-auth-required") {
        mfaResolver = getResolver(err);
        qs("mfa-challenge-code").value = "";
        qs("mfa-challenge-error").hidden = true;
        els.authScreen.hidden = true;
        els.mfaChallengeScreen.hidden = false;
      } else {
        showAuthError(err.message);
      }
    }
  });

  qs("sign-out-btn").addEventListener("click", () => signOutUser());
}

function showAuthError(message) {
  const el = qs("auth-error");
  el.textContent = message;
  el.hidden = false;
}

// ---- MFA (staff-only) -------------------------------------------------------

function wireMfaScreens() {
  qs("mfa-challenge-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = qs("mfa-challenge-code").value.trim();
    const errEl = qs("mfa-challenge-error");
    errEl.hidden = true;
    try {
      const cred = await completeMfaSignIn(mfaResolver, code);
      mfaResolver = null;
      els.mfaChallengeScreen.hidden = true;
      await afterSignIn(cred.user);
      // watchAuthState's onAuthStateChanged fires now that sign-in is fully resolved; it
      // picks the right shell from here (this account is already MFA-enrolled by definition).
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  qs("mfa-challenge-cancel").addEventListener("click", () => {
    mfaResolver = null;
    els.mfaChallengeScreen.hidden = true;
    els.authScreen.hidden = false;
  });

  qs("mfa-enroll-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = qs("mfa-enroll-code").value.trim();
    const errEl = qs("mfa-enroll-error");
    errEl.hidden = true;
    try {
      await finishMfaEnrollment(mfaEnrollSecret, code);
      const user = mfaEnrollUser;
      mfaEnrollSecret = null;
      mfaEnrollUser = null;
      els.mfaEnrollScreen.hidden = true;
      showStaffShell(user);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
  });

  qs("mfa-enroll-signout-btn").addEventListener("click", () => {
    mfaEnrollSecret = null;
    mfaEnrollUser = null;
    signOutUser();
  });
}

// Kicks off mandatory TOTP enrollment for a signed-in staff/admin account that hasn't set it
// up yet -- shows the QR code + manual key, and holds the app shell hidden until it's done.
async function startMfaEnrollmentFlow(user) {
  mfaEnrollUser = user;
  els.clientHubScreen.hidden = true;
  els.appShell.hidden = true;
  qs("mfa-enroll-code").value = "";
  qs("mfa-enroll-error").hidden = true;
  qs("mfa-enroll-form").hidden = false;
  els.mfaEnrollScreen.hidden = false;

  try {
    const { secret, qrCodeUrl, secretKey } = await startMfaEnrollment();
    mfaEnrollSecret = secret;
    const qrEl = qs("mfa-qr-code");
    qrEl.innerHTML = "";
    new QRCode(qrEl, qrCodeUrl);
    qs("mfa-secret-text").textContent = secretKey;
  } catch (err) {
    // Most likely cause: TOTP multi-factor auth hasn't been turned on yet in Firebase Console
    // -> Authentication -> Sign-in method -> Advanced (auth/operation-not-allowed). Surface that
    // clearly rather than leaving staff stuck on a blank enrollment screen with no way forward.
    qs("mfa-enroll-form").hidden = true;
    const errEl = qs("mfa-enroll-error");
    errEl.textContent =
      err.code === "auth/operation-not-allowed"
        ? "Two-factor authentication isn't enabled for this project yet. Contact your administrator."
        : err.message;
    errEl.hidden = false;
  }
}

function showStaffShell(user) {
  els.clientHubScreen.hidden = true;
  els.mfaEnrollScreen.hidden = true;
  els.appShell.hidden = false;
  const userColor = colorFor(user.email);
  els.userBadge.innerHTML = `
    <span class="avatar-badge" style="background:${tintFor(userColor)}; color:${userColor};">${user.email.slice(0, 2).toUpperCase()}</span>
    <span class="user-badge-email">${escapeHtml(user.email)}</span>
  `;
  startSync();
  seedCategoriesIfMissing(DEFAULT_CATEGORIES).catch((err) => console.error(err));
}

// ---- toolbar / view switching ----------------------------------------------

function wireToolbar() {
  els.viewToggleOverview.addEventListener("click", () => setActiveView("overview"));
  els.viewToggleCalendar.addEventListener("click", () => setActiveView("calendar"));
  els.viewToggleList.addEventListener("click", () => setActiveView("list"));
  els.viewToggleClientHub.addEventListener("click", () => setActiveView("clienthub"));
  els.listFilterClient.addEventListener("change", (e) => {
    viewState.clientFilter = e.target.value || null;
    renderCurrentView();
  });
  els.filterCategory.addEventListener("change", (e) => {
    viewState.categoryFilter = e.target.value || null;
    renderCurrentView();
  });
  els.markAllCompleteBtn.addEventListener("click", handleMarkAllShownComplete);

  els.clientSearch.addEventListener("input", (e) => {
    viewState.clientSearch = e.target.value;
    renderClientList();
  });

  qs("add-client-btn").addEventListener("click", () => openClientModal());
  qs("manage-categories-btn").addEventListener("click", () => openCategoriesModal());
  qs("bulk-add-item-btn").addEventListener("click", () => openBulkAddItemModal());
  qs("export-btn").addEventListener("click", openExportInfo);
  qs("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
}

function setActiveView(view) {
  viewState.view = view;
  localStorage.setItem("cct_view", view);
  els.viewToggleOverview.classList.toggle("active", view === "overview");
  els.viewToggleCalendar.classList.toggle("active", view === "calendar");
  els.viewToggleList.classList.toggle("active", view === "list");
  els.viewToggleClientHub.classList.toggle("active", view === "clienthub");
  qs("list-filter-wrap").hidden = view !== "list";
  els.markAllCompleteBtn.hidden = view !== "list";
  if (view !== "clienthub") {
    staffDocsUnsub?.();
    staffDocsUnsub = null;
  }
  // Category filtering and bulk item-add only mean anything for the compliance calendar/list --
  // showing them on Overview or Client Hub reads as unrelated clutter with nothing to act on.
  const isComplianceView = view === "calendar" || view === "list";
  els.categoryFilterWrap.hidden = !isComplianceView;
  els.bulkAddItemBtn.hidden = !isComplianceView;
  els.exportBtn.hidden = !isComplianceView;
  renderCurrentView();
}

function renderCurrentView() {
  if (!isFullyLoaded()) {
    els.viewContainer.innerHTML = `<div class="loading-hint"><span class="spinner"></span> Loading…</div>`;
    return;
  }
  if (viewState.view === "overview") {
    renderOverviewView();
    return;
  }
  if (viewState.view === "clienthub") {
    renderClientHubStaffView();
    return;
  }
  if (viewState.view === "calendar") {
    renderCalendar(els.viewContainer, {
      state: latestState,
      year: viewState.year,
      month: viewState.month,
      colorMode: viewState.colorMode,
      clientFilter: viewState.clientFilter,
      categoryFilter: viewState.categoryFilter,
      showArchived: viewState.showArchived,
      onPrev: () => shiftMonth(-1),
      onNext: () => shiftMonth(1),
      onToday: () => {
        const now = new Date();
        viewState.year = now.getFullYear();
        viewState.month = now.getMonth();
        renderCurrentView();
      },
      onColorModeChange: (mode) => {
        viewState.colorMode = mode;
        localStorage.setItem("cct_colormode", mode);
        renderCurrentView();
      },
      onJumpToMonth: () => openJumpToMonthModal(),
      onDayClick: (date, entries) => openDayModal(date, entries),
    });
  } else {
    const rangeStart = new Date(viewState.year, viewState.month - 1, 1);
    const rangeEnd = new Date(viewState.year, viewState.month + 4, 0);
    currentListRows = renderList(els.viewContainer, {
      state: latestState,
      clientFilter: viewState.clientFilter,
      categoryFilter: viewState.categoryFilter,
      showArchived: viewState.showArchived,
      rangeStart,
      rangeEnd,
      onToggleComplete: handleToggleComplete,
      onEditItem: (clientId, itemId) => openItemModal(clientId, itemId),
    });
  }
}

// ---- overview (firm-wide dashboard) -----------------------------------------------------

// Each item's most recent due-by-today occurrence, if it's still unchecked -- same definition
// list-view.js uses for its "Overdue" group, computed here across every client at once.
function computeOverdueItems() {
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  const rows = [];
  for (const item of latestState.items.values()) {
    const client = latestState.clients.get(item.clientId);
    if (!client || client.archived) continue;
    const occ = getLastDueOccurrence(item, today);
    if (!occ || occ.date >= today) continue;
    const forItem = latestState.completions.get(item.id);
    if (forItem && forItem.has(occ.periodKey)) continue;
    rows.push({ client, item, occ });
  }
  rows.sort((a, b) => a.occ.date - b.occ.date);
  return rows;
}

function computeAwaitingSignatureCount() {
  let count = 0;
  for (const letter of latestState.letters.values()) {
    const client = latestState.clients.get(letter.clientId);
    if (!client || client.archived) continue;
    if (letter.status === "sent") count++;
  }
  return count;
}

function renderOverviewView() {
  const activeClients = [...latestState.clients.values()].filter((c) => !c.archived);
  const overdue = computeOverdueItems();
  const awaitingSignature = computeAwaitingSignatureCount();

  els.viewContainer.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-icon-badge" style="background:${tintFor("#2563eb")}; color:#2563eb;">${iconUsers}</span>
          <span class="stat-card-label">Active clients</span>
        </div>
        <div class="stat-card-value">${activeClients.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-icon-badge" style="background:${tintFor("#d97706")}; color:#d97706;">${iconAlertTriangle}</span>
          <span class="stat-card-label">Overdue items</span>
        </div>
        <div class="${overdue.length ? "stat-card-value" : "stat-card-value-muted"}">${overdue.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-icon-badge" style="background:${tintFor("#7c3aed")}; color:#7c3aed;">${iconSignature}</span>
          <span class="stat-card-label">Awaiting signature</span>
        </div>
        <div class="${awaitingSignature ? "stat-card-value" : "stat-card-value-muted"}">${awaitingSignature}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-icon-badge" style="background:${tintFor("#0d9488")}; color:#0d9488;">${iconUpload}</span>
          <span class="stat-card-label">New uploads</span>
        </div>
        <div class="stat-card-value-muted">0</div>
        <div class="stat-card-label">Coming in Milestone 2</div>
      </div>
    </div>
    <h2 style="font-size:0.9rem; font-weight:600; margin:0 0 0.6rem;">Needs attention</h2>
    <div id="attention-list"></div>
  `;

  const list = qs("attention-list");
  if (overdue.length === 0) {
    list.innerHTML = `<div class="empty-hint">Nothing overdue. Nice.</div>`;
    return;
  }
  overdue.slice(0, 15).forEach(({ client, item, occ }) => {
    const label = item.customLabel || item.category;
    const color = colorFor(client.id);
    const row = document.createElement("button");
    row.className = "attention-row";
    row.innerHTML = `
      <span class="avatar-badge" style="background:${tintFor(color)}; color:${color};">${client.name.slice(0, 2).toUpperCase()}</span>
      <span style="flex:1;">${escapeHtml(client.name)} <span class="text-text-muted">-- ${escapeHtml(label)}</span></span>
      <span class="attention-badge">Due ${occ.date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
    `;
    row.addEventListener("click", () => openItemModal(client.id, item.id));
    list.appendChild(row);
  });
}

// ---- client hub (per-client tabs) --------------------------------------------------------

const CLIENT_HUB_TABS = [
  { id: "overview", label: "Overview" },
  { id: "compliance", label: "Compliance" },
  { id: "documents", label: "Documents" },
  { id: "letters", label: "Letters" },
];

let clientHubExpandedId = null;
let clientHubActiveTab = "overview";
let staffDocsUnsub = null;

function renderClientHubStaffView() {
  staffDocsUnsub?.();
  staffDocsUnsub = null;

  const clients = [...latestState.clients.values()]
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (clients.length === 0) {
    els.viewContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-badge empty-state-badge-primary">${iconFolderLarge}</div>
        <h3>No clients yet</h3>
        <p>Add a client first, then open them here to manage their Client Hub.</p>
      </div>`;
    return;
  }

  els.viewContainer.innerHTML = `<div class="client-accordion" id="client-accordion"></div>`;
  const accordion = qs("client-accordion");

  clients.forEach((client) => {
    const isOpen = clientHubExpandedId === client.id;
    const item = document.createElement("div");
    item.className = "client-accordion-item";

    const color = colorFor(client.id);
    const stats = clientCompletionStats(client.id);
    const pct = stats && stats.total ? Math.round((stats.current / stats.total) * 100) : null;

    const head = document.createElement("button");
    head.className = "client-accordion-row";
    head.innerHTML = `
      <span class="client-accordion-chevron${isOpen ? " client-accordion-chevron-open" : ""}">${iconChevronRight}</span>
      <span class="avatar-badge" style="background:${tintFor(color)}; color:${color};">${client.name.slice(0, 2).toUpperCase()}</span>
      <span style="flex:1; min-width:0;">
        <span>${escapeHtml(client.name)}</span>
        ${
          pct === null
            ? ""
            : `<div class="progress-track" style="max-width:180px;"><div class="progress-fill" style="width:${pct}%; background:${color};"></div></div>`
        }
      </span>
      ${pct === null ? "" : `<span class="text-[0.8rem] text-text-muted shrink-0">${stats.current}/${stats.total}</span>`}
    `;
    head.addEventListener("click", () => {
      clientHubExpandedId = isOpen ? null : client.id;
      clientHubActiveTab = "overview";
      renderCurrentView();
    });
    item.appendChild(head);

    if (isOpen) {
      const body = document.createElement("div");
      body.className = "client-accordion-body";

      const tabBar = document.createElement("div");
      tabBar.className = "client-tab-bar";
      CLIENT_HUB_TABS.forEach((tab) => {
        const btn = document.createElement("button");
        btn.className = `client-tab-btn${clientHubActiveTab === tab.id ? " client-tab-btn-active" : ""}`;
        btn.textContent = tab.label;
        btn.addEventListener("click", () => {
          clientHubActiveTab = tab.id;
          renderCurrentView();
        });
        tabBar.appendChild(btn);
      });
      body.appendChild(tabBar);

      const content = document.createElement("div");
      renderClientHubTabContent(content, client, clientHubActiveTab);
      body.appendChild(content);

      item.appendChild(body);
    }

    accordion.appendChild(item);
  });
}

function renderClientHubTabContent(container, client, tab) {
  if (tab === "compliance") {
    const now = new Date();
    const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 4, 0);
    renderList(container, {
      state: latestState,
      clientFilter: client.id,
      categoryFilter: null,
      showArchived: false,
      rangeStart,
      rangeEnd,
      onToggleComplete: handleToggleComplete,
      onEditItem: (clientId, itemId) => openItemModal(clientId, itemId),
    });
    return;
  }
  if (tab === "overview") {
    const stats = clientCompletionStats(client.id);
    container.innerHTML = `
      <p class="client-tab-content">${
        stats ? `${stats.current} of ${stats.total} compliance items on track.` : "No compliance items yet."
      }</p>
      <button class="btn btn-primary" style="margin-top:0.75rem;" data-action="invite-client">Invite to Client Hub</button>
    `;
    container.querySelector('[data-action="invite-client"]').addEventListener("click", () => openInviteClientModal(client));
    return;
  }
  if (tab === "documents") {
    container.innerHTML = `<div class="loading-hint"><span class="spinner"></span> Loading…</div>`;
    staffDocsUnsub = subscribeToDocuments(
      client.id,
      (documents) => renderDocumentList(container, documents, client.id, { allowReviewToggle: true }),
      (err) => {
        container.innerHTML = `<p class="client-tab-content">Could not load documents: ${escapeHtml(err.message)}</p>`;
      }
    );
    return;
  }
  if (tab === "letters") {
    const letters = [...latestState.letters.values()]
      .filter((l) => l.clientId === client.id)
      .sort((a, b) => (b.sentAt?.toMillis() || 0) - (a.sentAt?.toMillis() || 0));
    container.innerHTML = `
      <button class="btn btn-primary" style="margin-bottom:0.75rem;" data-action="send-letter">Send letter for signature</button>
      <div id="letter-list-staff"></div>
    `;
    container.querySelector('[data-action="send-letter"]').addEventListener("click", () => openSendLetterModal(client));
    // container isn't attached to the document yet at this point (renderClientHubStaffView
    // appends it to the accordion AFTER this function returns) -- qs()'s
    // document.getElementById would find nothing here, so this has to search within container
    // itself instead.
    renderLetterListStaff(container.querySelector("#letter-list-staff"), letters, client.id);
    return;
  }
}

function openInviteClientModal(client) {
  openModal(`
    <h2>Invite ${escapeHtml(client.name)}</h2>
    <p class="client-tab-content">Enter their email and we'll send them a link to set up their
    Client Hub account -- or leave it blank to just get a link you can share yourself.</p>
    <form id="invite-send-form">
      <label>Client's email (optional)<br/><input type="email" id="invite-recipient-email" placeholder="client@example.com" /></label>
      <div class="modal-actions" style="justify-content:flex-start;">
        <button type="submit" class="btn btn-primary" id="invite-generate-btn">Generate invite</button>
      </div>
    </form>
  `);

  qs("invite-send-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = qs("invite-recipient-email").value.trim();
    const btn = qs("invite-generate-btn");
    btn.disabled = true;
    btn.textContent = "Generating…";

    let token;
    try {
      token = await createClientInvite(client.id, email || null);
    } catch (err) {
      openModal(`
        <h2>Could not create invite</h2>
        <p class="client-tab-content">${escapeHtml(err.message)}</p>
        <div class="modal-actions"><button type="button" class="btn" data-action="close">Close</button></div>
      `);
      qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);
      return;
    }

    const link = `${window.location.origin}/invite.html?token=${token}&clientId=${client.id}`;
    openModal(`
      <h2>Invite ${escapeHtml(client.name)}</h2>
      <p class="client-tab-content" id="invite-status">
        ${
          email
            ? `Emailing <strong>${escapeHtml(email)}</strong> now…`
            : "No email address given -- share this link with them yourself."
        }
      </p>
      <div class="invite-link-row">
        <input type="text" id="invite-link-input" readonly value="${escapeHtml(link)}" />
        <button type="button" class="btn" id="invite-copy-btn">Copy</button>
      </div>
      <p class="client-tab-content">This link works once -- if they don't use it, come back here to
      generate a fresh one.</p>
      <div class="modal-actions"><button type="button" class="btn" data-action="close">Close</button></div>
    `);
    qs("invite-link-input").addEventListener("click", (ev) => ev.target.select());
    qs("invite-copy-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link);
        qs("invite-copy-btn").textContent = "Copied";
      } catch {
        qs("invite-link-input").select();
      }
    });
    qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);

    if (email) {
      let settled = false;
      const unsub = subscribeToInviteStatus(token, (invite) => {
        const statusEl = qs("invite-status");
        if (!statusEl) {
          unsub();
          return;
        }
        if (invite.emailSentAt) {
          statusEl.textContent = `Email sent to ${email}.`;
          settled = true;
          unsub();
        } else if (invite.emailError) {
          statusEl.textContent = `Could not email ${email}: ${invite.emailError} -- share the link below instead.`;
          settled = true;
          unsub();
        }
      });
      setTimeout(() => {
        if (settled) return;
        const statusEl = qs("invite-status");
        if (statusEl) statusEl.textContent = `Still sending to ${email} -- check back, or share the link below now.`;
      }, 12000);
    }
  });
}

// ---- document list rendering (shared by the staff Documents tab and the client-facing screen) --

function renderDocumentList(container, documents, clientId, { allowReviewToggle }) {
  if (documents.length === 0) {
    container.innerHTML = `<div class="empty-hint">No documents uploaded yet.</div>`;
    return;
  }
  container.innerHTML = documents.map((d) => documentRowHtml(d, allowReviewToggle)).join("");
  wireDocumentRows(container, clientId);
}

function documentRowHtml(d, allowReviewToggle) {
  const date = d.uploadedAt?.toDate ? d.uploadedAt.toDate().toLocaleDateString() : "Uploading…";
  const statusBadge = allowReviewToggle
    ? `<button class="doc-status-badge ${d.reviewed ? "doc-status-reviewed" : "doc-status-pending"}" data-action="toggle-reviewed" data-doc-id="${d.id}" data-reviewed="${d.reviewed ? "1" : ""}">${d.reviewed ? "Reviewed" : "Mark reviewed"}</button>`
    : `<span class="doc-status-badge ${d.reviewed ? "doc-status-reviewed" : "doc-status-pending"}">${d.reviewed ? "Reviewed" : "Pending review"}</span>`;
  // Clients can retract their own upload, but only before staff has reviewed it -- once
  // reviewed, firestore.rules/storage.rules would reject the delete anyway, so there's no
  // point showing a button that can only fail.
  const deleteBtn =
    !allowReviewToggle && !d.reviewed
      ? `<button class="icon-btn" data-action="delete" data-doc-id="${d.id}" data-storage-path="${escapeHtml(d.storagePath)}" data-file-name="${escapeHtml(d.fileName)}" title="Delete" aria-label="Delete ${escapeHtml(d.fileName)}">${iconTrash}</button>`
      : "";
  return `
    <div class="doc-row">
      <span class="doc-row-icon">${iconFile}</span>
      <span style="flex:1; min-width:0;">
        <div class="doc-row-name">${escapeHtml(d.fileName)}</div>
        <div class="doc-row-meta">${date} &middot; ${docTypeLabel(d.docType)}</div>
      </span>
      ${statusBadge}
      <button class="icon-btn" data-action="download" data-storage-path="${escapeHtml(d.storagePath)}" title="Download" aria-label="Download ${escapeHtml(d.fileName)}">${iconDownload}</button>
      ${deleteBtn}
    </div>`;
}

function wireDocumentRows(container, clientId) {
  container.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const url = await getDocumentDownloadURL(btn.dataset.storagePath);
        window.open(url, "_blank", "noopener");
      } catch (err) {
        alert("Could not open document: " + err.message);
      }
    });
  });
  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete "${btn.dataset.fileName}"? This can't be undone.`)) return;
      btn.disabled = true;
      try {
        await deleteDocument(clientId, btn.dataset.docId, btn.dataset.storagePath);
      } catch (err) {
        alert("Could not delete: " + err.message);
        btn.disabled = false;
      }
    });
  });
  container.querySelectorAll('[data-action="toggle-reviewed"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextReviewed = !btn.dataset.reviewed;
      btn.disabled = true;
      try {
        await setDocumentReviewed(clientId, btn.dataset.docId, nextReviewed);
      } catch (err) {
        alert("Could not update: " + err.message);
        btn.disabled = false;
      }
    });
  });
}

// ---- engagement letters (staff side: send + track; rendering shared list-row look with docs) --

function renderLetterListStaff(container, letters, clientId) {
  if (letters.length === 0) {
    container.innerHTML = `<div class="empty-hint">No letters sent yet.</div>`;
    return;
  }
  container.innerHTML = letters.map(letterRowHtml).join("");
  wireLetterRowsStaff(container, clientId);
}

function letterRowHtml(l) {
  const sentDate = l.sentAt?.toDate ? l.sentAt.toDate().toLocaleDateString() : "Sending…";
  const meta =
    l.status === "signed" && l.signedAt?.toDate
      ? `Signed by ${escapeHtml(l.signerName || "")} on ${l.signedAt.toDate().toLocaleDateString()}`
      : `Sent ${sentDate} by ${escapeHtml(l.sentBy || "")}`;
  const statusBadge =
    l.status === "signed"
      ? `<span class="doc-status-badge doc-status-reviewed">Signed</span>`
      : `<span class="doc-status-badge doc-status-pending">Awaiting signature</span>`;
  // Only an unsigned letter can be deleted (correcting a bad send) -- once signed it's an audit
  // record, and firestore.rules/storage.rules would reject the delete anyway.
  const deleteBtn =
    l.status !== "signed"
      ? `<button class="icon-btn" data-action="delete-letter" data-letter-id="${l.id}" data-storage-path="${escapeHtml(l.storagePath)}" title="Delete" aria-label="Delete ${escapeHtml(l.title)}">${iconTrash}</button>`
      : "";
  return `
    <div class="doc-row">
      <span class="doc-row-icon">${iconSignature}</span>
      <span style="flex:1; min-width:0;">
        <div class="doc-row-name">${escapeHtml(l.title)}</div>
        <div class="doc-row-meta">${meta}</div>
      </span>
      ${statusBadge}
      <button class="icon-btn" data-action="download" data-storage-path="${escapeHtml(l.storagePath)}" title="Download original" aria-label="Download original">${iconDownload}</button>
      ${l.signedPdfPath ? `<button class="icon-btn" data-action="download" data-storage-path="${escapeHtml(l.signedPdfPath)}" title="Download signed copy" aria-label="Download signed copy">${iconFile}</button>` : ""}
      ${deleteBtn}
    </div>`;
}

function wireLetterRowsStaff(container, clientId) {
  container.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const url = await getLetterDownloadURL(btn.dataset.storagePath);
        window.open(url, "_blank", "noopener");
      } catch (err) {
        alert("Could not open document: " + err.message);
      }
    });
  });
  container.querySelectorAll('[data-action="delete-letter"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this letter? This can't be undone.")) return;
      btn.disabled = true;
      try {
        await deleteLetter(clientId, btn.dataset.letterId, btn.dataset.storagePath);
      } catch (err) {
        alert("Could not delete: " + err.message);
        btn.disabled = false;
      }
    });
  });
}

// Two-step: (1) title + file + the IRS-form guardrail, same as before; (2) place signature/date
// boxes on the actual rendered document before it goes out. Step 2 needs real width, hence
// openModal's wide variant.
function openSendLetterModal(client) {
  renderSendLetterStep1(client);
}

function renderSendLetterStep1(client) {
  openModal(`
    <h2>Send letter to ${escapeHtml(client.name)}</h2>
    <p class="client-tab-content">Upload a PDF, then place signature/date boxes on it -- your
    client will see the real document with those boxes and sign it there.</p>
    <form id="send-letter-form">
      <label>Title<br/><input type="text" id="letter-title-input" placeholder="2025 Engagement Letter" required /></label>
      <label style="display:block; margin-top:0.75rem;">PDF file<br/><input type="file" id="letter-file-input" accept="application/pdf" required /></label>
      <div class="notice-warning" style="margin-top:0.75rem;">
        <strong>Not for IRS forms.</strong> This signs with a typed/drawn signature and an audit
        trail, which is enough for engagement letters and ACH-style authorizations -- but forms
        like 8879 or 2848 legally require IRS identity verification (KBA) we don't do here. Get
        those signed in person, or through a platform built for it.
      </div>
      <label class="confirm-checkbox" style="margin-top:0.75rem;">
        <input type="checkbox" id="letter-irs-confirm" required />
        This is not an IRS form requiring e-file/IRS signature authorization.
      </label>
      <div id="send-letter-error" class="auth-error" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close">Cancel</button>
        <button type="submit" class="btn btn-primary" id="send-letter-continue-btn">Continue</button>
      </div>
    </form>
  `);
  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);

  qs("send-letter-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = qs("letter-title-input").value.trim();
    const file = qs("letter-file-input").files[0];
    const errEl = qs("send-letter-error");
    errEl.hidden = true;
    if (!file || file.type !== "application/pdf") {
      errEl.textContent = "Please choose a PDF file.";
      errEl.hidden = false;
      return;
    }
    const btn = qs("send-letter-continue-btn");
    btn.disabled = true;
    btn.textContent = "Loading…";
    try {
      const pdfBytes = await file.arrayBuffer();
      const pdfDoc = await loadPdfDocument(new Uint8Array(pdfBytes));
      renderFieldPlacementStep(client, { file, title, pdfDoc });
    } catch (err) {
      errEl.textContent = "Could not open that PDF: " + err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Continue";
    }
  });
}

async function renderFieldPlacementStep(client, { file, title, pdfDoc }) {
  let fields = [];
  let armedType = null;

  openModal(
    `
    <h2>Place signature fields</h2>
    <p class="field-placement-hint">Click "Add signature box" or "Add date box", then click on
    the document below to drop it there. At least one signature box is required.</p>
    <div class="field-toolbar">
      <button type="button" class="btn" id="add-signature-field-btn">+ Signature box</button>
      <button type="button" class="btn" id="add-date-field-btn">+ Date box</button>
    </div>
    <div class="pdf-pages-scroll" id="field-pages-container"></div>
    <div id="field-placement-error" class="auth-error" style="margin-top:0.75rem;" hidden></div>
    <div class="modal-actions">
      <button type="button" class="btn" id="field-placement-back-btn">Back</button>
      <button type="button" class="btn btn-primary" id="field-placement-send-btn">Send</button>
    </div>
  `,
    { wide: true }
  );

  const pagesContainer = qs("field-pages-container");
  const addSigBtn = qs("add-signature-field-btn");
  const addDateBtn = qs("add-date-field-btn");

  function setArmed(type) {
    armedType = armedType === type ? null : type;
    pagesContainer
      .querySelectorAll(".pdf-page-wrap")
      .forEach((el) => el.classList.toggle("pdf-page-wrap-placing", !!armedType));
    addSigBtn.classList.toggle("btn-primary", armedType === "signature");
    addDateBtn.classList.toggle("btn-primary", armedType === "date");
  }

  function addFieldBox(wrap, field) {
    const box = document.createElement("div");
    box.className = `pdf-field-box pdf-field-box-${field.type}`;
    box.style.left = `${field.xPct * 100}%`;
    box.style.top = `${field.yPct * 100}%`;
    box.style.width = `${field.widthPct * 100}%`;
    box.style.height = `${field.heightPct * 100}%`;
    box.textContent = field.type === "signature" ? "Signature" : "Date";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "pdf-field-delete-btn";
    del.textContent = "×";
    del.title = "Remove";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      fields = fields.filter((f) => f.id !== field.id);
      box.remove();
    });
    box.appendChild(del);
    wrap.appendChild(box);
  }

  addSigBtn.addEventListener("click", () => setArmed("signature"));
  addDateBtn.addEventListener("click", () => setArmed("date"));

  // Fits the rendered page to whatever width the viewer actually has (narrow on mobile, capped
  // on desktop) -- a fixed width here would either overflow small screens or render needlessly
  // small on large ones.
  const targetWidth = Math.min(740, Math.max(260, pagesContainer.clientWidth - 24));
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const wrap = document.createElement("div");
    wrap.className = "pdf-page-wrap";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    pagesContainer.appendChild(wrap);
    const { width, height } = await renderPdfPageToCanvas(pdfDoc, i, canvas, targetWidth);
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;

    const pageIndex = i - 1;
    wrap.addEventListener("click", (e) => {
      if (!armedType) return;
      const rect = wrap.getBoundingClientRect();
      const size = FIELD_DEFAULT_SIZE[armedType];
      const xPct = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1 - size.widthPct);
      const yPct = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1 - size.heightPct);
      const field = { id: crypto.randomUUID(), type: armedType, page: pageIndex, xPct, yPct, ...size };
      fields.push(field);
      addFieldBox(wrap, field);
      setArmed(null);
    });
  }

  qs("field-placement-back-btn").addEventListener("click", () => renderSendLetterStep1(client));

  qs("field-placement-send-btn").addEventListener("click", async () => {
    const errEl = qs("field-placement-error");
    errEl.hidden = true;
    if (!fields.some((f) => f.type === "signature")) {
      errEl.textContent = "Add at least one signature box before sending.";
      errEl.hidden = false;
      return;
    }
    const btn = qs("field-placement-send-btn");
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      await sendLetter(client.id, file, title, auth.currentUser.email, fields);
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Send";
    }
  });
}

// ---- client hub (client-facing screen) --------------------------------------------------

let clientHubClientId = null;
let clientHubClientName = "";
let clientDocsUnsub = null;
let clientLettersUnsub = null;
let clientComplianceUnsub = null;
let clientLatestDocuments = [];
let clientLatestLetters = [];

function wireClientHubScreen() {
  qs("client-hub-signout-btn").addEventListener("click", () => signOutUser());
  qs("chub-doctype").innerHTML = DOC_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");
  qs("chub-dropzone-icon").innerHTML = iconUploadLarge;

  qs("chub-tab-documents").addEventListener("click", () => setClientHubTab("documents"));
  qs("chub-tab-letters").addEventListener("click", () => setClientHubTab("letters"));
  qs("chub-tab-compliance").addEventListener("click", () => setClientHubTab("compliance"));

  const dropzone = qs("chub-dropzone");
  const fileInput = qs("chub-file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dropzone-active"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone-active");
    if (e.dataTransfer.files.length) handleClientUpload(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) handleClientUpload(fileInput.files);
    fileInput.value = "";
  });
}

function setClientHubTab(tab) {
  qs("chub-tab-documents").classList.toggle("client-tab-btn-active", tab === "documents");
  qs("chub-tab-letters").classList.toggle("client-tab-btn-active", tab === "letters");
  qs("chub-tab-compliance").classList.toggle("client-tab-btn-active", tab === "compliance");
  qs("chub-panel-documents").hidden = tab !== "documents";
  qs("chub-panel-letters").hidden = tab !== "letters";
  qs("chub-panel-compliance").hidden = tab !== "compliance";

  if (tab === "compliance" && !clientComplianceUnsub && clientHubClientId) {
    const panel = qs("chub-panel-compliance");
    panel.innerHTML = `<div class="loading-hint"><span class="spinner"></span> Loading…</div>`;
    clientComplianceUnsub = subscribeToOwnCompliance(clientHubClientId, clientHubClientName, (state) => {
      const now = new Date();
      const rangeStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const rangeEnd = new Date(now.getFullYear(), now.getMonth() + 4, 0);
      renderList(panel, {
        state,
        clientFilter: clientHubClientId,
        categoryFilter: null,
        showArchived: false,
        rangeStart,
        rangeEnd,
        readOnly: true,
      });
    });
  }
}

// Uploads a FileList sequentially (simpler progress reporting than parallel, and avoids
// hammering Storage with many simultaneous resumable-upload sessions from one click).
async function handleClientUpload(fileList) {
  if (!clientHubClientId || !auth.currentUser) return;
  const files = [...fileList];
  const errorEl = qs("chub-upload-error");
  const statusEl = qs("chub-upload-status");
  errorEl.hidden = true;
  const progressWrap = qs("chub-upload-progress");
  const progressFill = progressWrap.querySelector(".progress-fill");
  progressWrap.hidden = false;
  statusEl.hidden = false;

  const docType = qs("chub-doctype").value;
  const failures = [];

  for (let i = 0; i < files.length; i++) {
    statusEl.textContent = files.length > 1 ? `Uploading ${i + 1} of ${files.length}: ${files[i].name}` : `Uploading ${files[i].name}…`;
    progressFill.style.width = "0%";
    try {
      await uploadDocument(clientHubClientId, files[i], docType, auth.currentUser.email, (pct) => {
        progressFill.style.width = `${pct}%`;
      });
    } catch (err) {
      failures.push(`${files[i].name}: ${err.message}`);
    }
  }

  progressWrap.hidden = true;
  statusEl.hidden = true;
  if (failures.length) {
    errorEl.textContent = `Could not upload ${failures.length} of ${files.length} file(s) -- ${failures.join("; ")}`;
    errorEl.hidden = false;
  }
}

async function showClientHub(profile) {
  els.clientHubScreen.hidden = false;
  els.clientHubName.textContent = "";
  if (!profile.clientId) {
    els.clientHubName.textContent = " -- ask your accountant to finish setting up your account (missing clientId).";
    return;
  }
  clientHubClientId = profile.clientId;
  try {
    const client = await getClientRecord(profile.clientId);
    clientHubClientName = client ? client.name : "";
    els.clientHubName.textContent = client ? `, ${client.name}` : "";
  } catch (err) {
    console.error(err);
  }

  setClientHubTab("documents");

  clientDocsUnsub?.();
  clientDocsUnsub = subscribeToDocuments(
    profile.clientId,
    (documents) => {
      clientLatestDocuments = documents;
      renderDocumentList(qs("chub-document-list"), documents, profile.clientId, { allowReviewToggle: false });
      renderClientStatGrid();
    },
    (err) => console.error(err)
  );

  clientLettersUnsub?.();
  clientLettersUnsub = subscribeToLetters(
    profile.clientId,
    (letters) => {
      clientLatestLetters = letters;
      renderLetterListClient(qs("chub-letter-list"), letters, profile.clientId);
      renderClientStatGrid();
    },
    (err) => console.error(err)
  );
}

function renderClientStatGrid() {
  const pending = clientLatestDocuments.filter((d) => !d.reviewed).length;
  const needsSignature = clientLatestLetters.filter((l) => l.status === "sent").length;
  qs("chub-stat-grid").innerHTML = `
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-icon-badge" style="background:${tintFor("#2563eb")}; color:#2563eb;">${iconFile}</span>
        <span class="stat-card-label">Documents uploaded</span>
      </div>
      <div class="stat-card-value">${clientLatestDocuments.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-icon-badge" style="background:${tintFor("#d97706")}; color:#d97706;">${iconClock}</span>
        <span class="stat-card-label">Pending review</span>
      </div>
      <div class="${pending ? "stat-card-value" : "stat-card-value-muted"}">${pending}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-header">
        <span class="stat-icon-badge" style="background:${tintFor("#7c3aed")}; color:#7c3aed;">${iconSignature}</span>
        <span class="stat-card-label">Needs your signature</span>
      </div>
      <div class="${needsSignature ? "stat-card-value" : "stat-card-value-muted"}">${needsSignature}</div>
    </div>
  `;
}

// ---- engagement letters (client-facing) --------------------------------------------------

function renderLetterListClient(container, letters, clientId) {
  if (letters.length === 0) {
    container.innerHTML = `<div class="empty-hint">No letters yet.</div>`;
    return;
  }
  container.innerHTML = letters.map(letterRowHtmlClient).join("");
  wireLetterRowsClient(container, clientId, letters);
}

function letterRowHtmlClient(l) {
  const meta =
    l.status === "signed" && l.signedAt?.toDate
      ? `Signed on ${l.signedAt.toDate().toLocaleDateString()}`
      : `Sent ${l.sentAt?.toDate ? l.sentAt.toDate().toLocaleDateString() : "recently"}`;
  const statusBadge =
    l.status === "signed"
      ? `<span class="doc-status-badge doc-status-reviewed">Signed</span>`
      : `<span class="doc-status-badge doc-status-pending">Needs signature</span>`;
  const actionBtn =
    l.status === "sent"
      ? `<button class="btn btn-primary btn-sm" data-action="sign" data-letter-id="${l.id}">Sign now</button>`
      : `<button class="icon-btn" data-action="download" data-storage-path="${escapeHtml(l.signedPdfPath || l.storagePath)}" title="Download" aria-label="Download signed copy">${iconDownload}</button>`;
  return `
    <div class="doc-row">
      <span class="doc-row-icon">${iconSignature}</span>
      <span style="flex:1; min-width:0;">
        <div class="doc-row-name">${escapeHtml(l.title)}</div>
        <div class="doc-row-meta">${meta}</div>
      </span>
      ${statusBadge}
      ${actionBtn}
    </div>`;
}

function wireLetterRowsClient(container, clientId, letters) {
  container.querySelectorAll('[data-action="sign"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const letter = letters.find((l) => l.id === btn.dataset.letterId);
      if (letter) openSignLetterModal(clientId, letter);
    });
  });
  container.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const url = await getLetterDownloadURL(btn.dataset.storagePath);
        window.open(url, "_blank", "noopener");
      } catch (err) {
        alert("Could not open document: " + err.message);
      }
    });
  });
}

// Sign modal: client can either draw on a canvas or type their name (rendered in a cursive font
// and rasterized the same way a drawn signature is -- see pdf-sign.js's renderTypedSignature),
// then the signature + an audit line get stamped directly onto the PDF client-side before the
// flattened result is uploaded as the record of record (see letters.js's signLetter).
// Letters sent with staff-placed fields (the normal case) get the real document viewer below;
// older letters sent before fields existed fall back to the original single-fixed-spot flow.
function openSignLetterModal(clientId, letter) {
  if (letter.fields && letter.fields.length > 0) {
    openSignLetterModalWithFields(clientId, letter);
  } else {
    openSignLetterModalLegacy(clientId, letter);
  }
}

// Shows the actual document (rendered page by page) with staff-placed signature/date boxes
// overlaid at their real positions. The client provides ONE signature; the instant they do, it's
// stamped into every signature box (and today's date into every date box) as a live preview
// right there on the document, and only then does Submit unlock -- so "all boxes signed" is
// always true by construction rather than something tracked per box.
async function openSignLetterModalWithFields(clientId, letter) {
  let signMethod = "draw";
  let canvasControls = null;
  let signed = false;
  let capturedSignerName = "";
  let capturedSignatureImage = "";
  let originalPdfBytes = null;

  const cleanup = () => {
    canvasControls?.destroy();
    canvasControls = null;
  };

  openModal(
    `
    <h2>Sign: ${escapeHtml(letter.title)}</h2>
    <p class="field-placement-hint">Review the document below, then provide your signature --
    it'll be placed in every signature box shown.</p>
    <div class="pdf-pages-scroll" id="sign-pages-container">
      <div class="loading-hint"><span class="spinner"></span> Loading document…</div>
    </div>

    <div class="chub-card" style="margin-top:1rem;">
      <label>Full legal name<br/><input type="text" id="sign-name-input" required placeholder="Jane Smith" /></label>
      <div class="sign-method-tabs" style="margin-top:1rem;">
        <button type="button" class="client-tab-btn client-tab-btn-active" data-sign-method="draw">Draw signature</button>
        <button type="button" class="client-tab-btn" data-sign-method="type">Type signature</button>
      </div>
      <div id="sign-draw-panel">
        <canvas id="sign-canvas" class="sign-canvas" width="480" height="140"></canvas>
        <button type="button" class="btn btn-ghost btn-sm" id="sign-clear-btn" style="margin-top:0.4rem;">Clear</button>
      </div>
      <div id="sign-type-panel" hidden>
        <div id="sign-type-preview" class="sign-type-preview">Type your name above</div>
      </div>
      <div id="sign-error" class="auth-error" hidden style="margin-top:0.75rem;"></div>
      <button type="button" class="btn btn-primary" id="apply-signature-btn" style="margin-top:0.75rem;">Apply signature to document</button>
    </div>

    <div class="modal-actions">
      <button type="button" class="btn" data-action="close">Cancel</button>
      <button type="button" class="btn btn-primary" id="sign-submit-btn" disabled>Submit signed document</button>
    </div>
  `,
    { wide: true }
  );

  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", () => {
    cleanup();
    closeModal();
  });

  canvasControls = wireSignatureCanvas(qs("sign-canvas"));
  qs("sign-clear-btn").addEventListener("click", () => canvasControls.clear());

  const nameInput = qs("sign-name-input");
  const updateTypePreview = () => {
    qs("sign-type-preview").textContent = nameInput.value.trim() || "Type your name above";
  };
  nameInput.addEventListener("input", updateTypePreview);

  qs("modal-content").querySelectorAll("[data-sign-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      signMethod = btn.dataset.signMethod;
      qs("modal-content").querySelectorAll("[data-sign-method]").forEach((b) =>
        b.classList.toggle("client-tab-btn-active", b === btn)
      );
      qs("sign-draw-panel").hidden = signMethod !== "draw";
      qs("sign-type-panel").hidden = signMethod !== "type";
      if (signMethod === "type") updateTypePreview();
    });
  });

  const boxElsByField = new Map(); // field.id -> the overlay element, so applying a signature can find every box
  const pagesContainer = qs("sign-pages-container");
  try {
    const url = await getLetterDownloadURL(letter.storagePath);
    originalPdfBytes = await fetch(url).then((r) => r.arrayBuffer());
    const pdfDoc = await loadPdfDocument(new Uint8Array(originalPdfBytes));
    const fieldsByPage = new Map();
    for (const f of letter.fields) {
      if (!fieldsByPage.has(f.page)) fieldsByPage.set(f.page, []);
      fieldsByPage.get(f.page).push(f);
    }

    pagesContainer.innerHTML = "";
    const targetWidth = Math.min(700, Math.max(260, pagesContainer.clientWidth - 24));
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const wrap = document.createElement("div");
      wrap.className = "pdf-page-wrap";
      const canvas = document.createElement("canvas");
      wrap.appendChild(canvas);
      pagesContainer.appendChild(wrap);
      const { width, height } = await renderPdfPageToCanvas(pdfDoc, i, canvas, targetWidth);
      wrap.style.width = `${width}px`;
      wrap.style.height = `${height}px`;

      for (const field of fieldsByPage.get(i - 1) || []) {
        const box = document.createElement("div");
        box.className = `pdf-field-box pdf-field-box-${field.type}`;
        box.style.left = `${field.xPct * 100}%`;
        box.style.top = `${field.yPct * 100}%`;
        box.style.width = `${field.widthPct * 100}%`;
        box.style.height = `${field.heightPct * 100}%`;
        box.textContent = field.type === "signature" ? "Sign here" : "Date";
        wrap.appendChild(box);
        boxElsByField.set(field.id, box);
      }
    }
  } catch (err) {
    pagesContainer.innerHTML = `<p class="client-tab-content">Could not load the document: ${escapeHtml(err.message)}</p>`;
  }

  qs("apply-signature-btn").addEventListener("click", () => {
    const errEl = qs("sign-error");
    errEl.hidden = true;
    const signerName = nameInput.value.trim();
    if (!signerName) {
      errEl.textContent = "Enter your full legal name.";
      errEl.hidden = false;
      return;
    }
    let signatureImage;
    if (signMethod === "draw") {
      if (canvasControls.isEmpty()) {
        errEl.textContent = `Draw your signature, or switch to "Type signature".`;
        errEl.hidden = false;
        return;
      }
      signatureImage = canvasControls.toDataUrl();
    } else {
      signatureImage = renderTypedSignature(signerName);
    }

    const dateText = new Date().toLocaleDateString();
    for (const field of letter.fields) {
      const box = boxElsByField.get(field.id);
      if (!box) continue;
      box.classList.add("pdf-field-box-filled");
      box.textContent = "";
      if (field.type === "signature") {
        const img = document.createElement("img");
        img.src = signatureImage;
        box.appendChild(img);
      } else {
        box.textContent = dateText;
      }
    }

    capturedSignerName = signerName;
    capturedSignatureImage = signatureImage;
    signed = true;
    const applyBtn = qs("apply-signature-btn");
    applyBtn.disabled = true;
    applyBtn.textContent = "Signature applied";
    qs("sign-submit-btn").disabled = false;
  });

  qs("sign-submit-btn").addEventListener("click", async () => {
    if (!signed || !originalPdfBytes) return;
    const errEl = qs("sign-error");
    errEl.hidden = true;
    const btn = qs("sign-submit-btn");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      const ip = await fetchPublicIp();
      const signedPdfBytes = await stampFields(originalPdfBytes, {
        fields: letter.fields,
        signatureImageDataUrl: capturedSignatureImage,
        signerName: capturedSignerName,
        ip,
      });
      await signLetter(clientId, letter.id, {
        signedPdfBytes,
        signerName: capturedSignerName,
        signMethod,
        signerIp: ip,
      });
      cleanup();
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Submit signed document";
    }
  });
}

// Fallback for letters sent before staff-placed fields existed -- the original flow: sign once,
// stamped at a single fixed spot near the bottom of the last page (pdf-sign.js's stampSignature).
function openSignLetterModalLegacy(clientId, letter) {
  let signMethod = "draw";
  let canvasControls = null;
  const cleanup = () => {
    canvasControls?.destroy();
    canvasControls = null;
  };

  openModal(`
    <h2>Sign: ${escapeHtml(letter.title)}</h2>
    <p class="client-tab-content">Review the document, then sign below.</p>
    <button type="button" class="btn btn-ghost" id="sign-view-doc-btn" style="margin-bottom:1rem;">View document to sign</button>

    <label>Full legal name<br/><input type="text" id="sign-name-input" required placeholder="Jane Smith" /></label>

    <div class="sign-method-tabs" style="margin-top:1rem;">
      <button type="button" class="client-tab-btn client-tab-btn-active" data-sign-method="draw">Draw signature</button>
      <button type="button" class="client-tab-btn" data-sign-method="type">Type signature</button>
    </div>
    <div id="sign-draw-panel">
      <canvas id="sign-canvas" class="sign-canvas" width="480" height="140"></canvas>
      <button type="button" class="btn btn-ghost btn-sm" id="sign-clear-btn" style="margin-top:0.4rem;">Clear</button>
    </div>
    <div id="sign-type-panel" hidden>
      <div id="sign-type-preview" class="sign-type-preview">Type your name above</div>
    </div>

    <div id="sign-error" class="auth-error" hidden style="margin-top:0.75rem;"></div>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="close">Cancel</button>
      <button type="button" class="btn btn-primary" id="sign-submit-btn">Sign and submit</button>
    </div>
  `);

  qs("sign-view-doc-btn").addEventListener("click", async () => {
    try {
      const url = await getLetterDownloadURL(letter.storagePath);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      alert("Could not open document: " + err.message);
    }
  });

  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", () => {
    cleanup();
    closeModal();
  });

  canvasControls = wireSignatureCanvas(qs("sign-canvas"));
  qs("sign-clear-btn").addEventListener("click", () => canvasControls.clear());

  const nameInput = qs("sign-name-input");
  const updateTypePreview = () => {
    qs("sign-type-preview").textContent = nameInput.value.trim() || "Type your name above";
  };
  nameInput.addEventListener("input", updateTypePreview);

  qs("modal-content").querySelectorAll("[data-sign-method]").forEach((btn) => {
    btn.addEventListener("click", () => {
      signMethod = btn.dataset.signMethod;
      qs("modal-content").querySelectorAll("[data-sign-method]").forEach((b) =>
        b.classList.toggle("client-tab-btn-active", b === btn)
      );
      qs("sign-draw-panel").hidden = signMethod !== "draw";
      qs("sign-type-panel").hidden = signMethod !== "type";
      if (signMethod === "type") updateTypePreview();
    });
  });

  qs("sign-submit-btn").addEventListener("click", async () => {
    const errEl = qs("sign-error");
    errEl.hidden = true;
    const signerName = nameInput.value.trim();
    if (!signerName) {
      errEl.textContent = "Enter your full legal name.";
      errEl.hidden = false;
      return;
    }
    let signatureImage;
    if (signMethod === "draw") {
      if (canvasControls.isEmpty()) {
        errEl.textContent = `Draw your signature, or switch to "Type signature".`;
        errEl.hidden = false;
        return;
      }
      signatureImage = canvasControls.toDataUrl();
    } else {
      signatureImage = renderTypedSignature(signerName);
    }

    const btn = qs("sign-submit-btn");
    btn.disabled = true;
    btn.textContent = "Signing…";
    try {
      const originalUrl = await getLetterDownloadURL(letter.storagePath);
      const pdfBytes = await fetch(originalUrl).then((r) => r.arrayBuffer());
      const ip = await fetchPublicIp();
      const signedPdfBytes = await stampSignature(pdfBytes, {
        signatureImageDataUrl: signatureImage,
        signerName,
        signedAtText: new Date().toLocaleString(),
        ip,
      });
      await signLetter(clientId, letter.id, { signedPdfBytes, signerName, signMethod, signerIp: ip });
      cleanup();
      closeModal();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = "Sign and submit";
    }
  });
}

async function handleMarkAllShownComplete() {
  if (currentListRows.length === 0) {
    alert("Nothing shown is left to mark complete.");
    return;
  }
  if (!confirm(`Mark all ${currentListRows.length} shown item(s) as complete?`)) return;

  els.markAllCompleteBtn.disabled = true;
  try {
    for (const { clientId, itemId, periodKey } of currentListRows) {
      await markComplete(clientId, itemId, periodKey);
    }
  } catch (err) {
    alert("Could not mark everything complete: " + err.message);
  } finally {
    els.markAllCompleteBtn.disabled = false;
  }
}

function shiftMonth(delta) {
  viewState.month += delta;
  if (viewState.month < 0) {
    viewState.month = 11;
    viewState.year -= 1;
  } else if (viewState.month > 11) {
    viewState.month = 0;
    viewState.year += 1;
  }
  renderCurrentView();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function openJumpToMonthModal() {
  openModal(`
    <h2>Jump to month</h2>
    <form id="jump-form">
      <label>Month<br/>
        <select id="jump-month">
          ${MONTH_NAMES.map((name, i) => `<option value="${i}" ${i === viewState.month ? "selected" : ""}>${name}</option>`).join("")}
        </select>
      </label>
      <label>Year<br/><input type="number" id="jump-year" value="${viewState.year}" /></label>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Go</button>
      </div>
    </form>
  `);
  qs("jump-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const year = Number(qs("jump-year").value);
    const month = Number(qs("jump-month").value);
    if (!year) return;
    viewState.year = year;
    viewState.month = month;
    closeModal();
    renderCurrentView();
  });
  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

async function handleToggleComplete(clientId, itemId, periodKey, checked) {
  try {
    if (checked) await markComplete(clientId, itemId, periodKey);
    else await unmarkComplete(clientId, itemId, periodKey);
  } catch (err) {
    alert("Could not save: " + err.message);
  }
}

// ---- client sidebar ---------------------------------------------------------

function clientCompletionStats(clientId) {
  const items = [...latestState.items.values()].filter((i) => i.clientId === clientId);
  if (items.length === 0) return null;
  const today = new Date(new Date().setHours(0, 0, 0, 0));
  let current = 0;
  for (const item of items) {
    const occ = getLastDueOccurrence(item, today);
    const forItem = latestState.completions.get(item.id);
    const overdue = occ && occ.date < today && !(forItem && forItem.has(occ.periodKey));
    if (!overdue) current++;
  }
  return { current, total: items.length };
}

function renderClientList() {
  const allClients = [...latestState.clients.values()].sort((a, b) => a.name.localeCompare(b.name));
  const activeClients = allClients.filter((c) => !c.archived);
  const archivedCount = allClients.length - activeClients.length;
  const baseClients = viewState.showArchived ? allClients : activeClients;
  const query = viewState.clientSearch.trim().toLowerCase();
  const clients = query ? baseClients.filter((c) => c.name.toLowerCase().includes(query)) : baseClients;
  const isAdmin = latestState.currentUserRole === "admin";

  if (!isFullyLoaded()) {
    els.clientList.innerHTML = `<div class="loading-hint"><span class="spinner"></span> Loading…</div>`;
  } else if (allClients.length === 0) {
    els.clientList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-badge empty-state-badge-primary">${iconPlusLarge}</div>
        <h3>No clients yet</h3>
        <p>Click "Add Client" above to get started.</p>
      </div>`;
  } else if (clients.length === 0) {
    els.clientList.innerHTML = `<div class="empty-hint">No clients match "${escapeHtml(viewState.clientSearch)}".</div>`;
  } else {
    els.clientList.innerHTML = clients
      .map((c) => {
        const stats = clientCompletionStats(c.id);
        const progressBadge = stats
          ? `<span class="client-progress ${stats.current === stats.total ? "client-progress-ok" : "client-progress-behind"}">${stats.current}/${stats.total}</span>`
          : "";
        return `
        <div class="client-row ${viewState.clientFilter === c.id ? "client-row-active" : ""} ${c.archived ? "client-row-archived" : ""}" data-client-id="${c.id}">
          <span class="client-dot" style="background:${colorFor(c.id)}"></span>
          <span class="client-name" data-action="filter">${escapeHtml(c.name)}${c.archived ? ' <span class="client-archived-tag">Archived</span>' : ""}</span>
          ${progressBadge}
          <span class="client-actions">
            <button class="icon-btn" data-action="add-item" title="Add item">${iconPlus}</button>
            <button class="icon-btn" data-action="edit" title="Edit client">${iconEdit}</button>
            ${isAdmin ? `<button class="icon-btn" data-action="delete" title="Delete client">${iconTrash}</button>` : ""}
          </span>
        </div>`;
      })
      .join("");
  }

  if (archivedCount > 0) {
    els.clientList.innerHTML += `
      <label class="show-archived-toggle">
        <input type="checkbox" id="show-archived-checkbox" ${viewState.showArchived ? "checked" : ""} />
        ${viewState.showArchived ? "Hide" : "Show"} ${archivedCount} archived client${archivedCount === 1 ? "" : "s"}
      </label>`;
    qs("show-archived-checkbox").addEventListener("change", (e) => {
      viewState.showArchived = e.target.checked;
      renderClientList();
      renderCurrentView();
    });
  }

  const clientFilterOptions = viewState.showArchived ? allClients : activeClients;
  els.listFilterClient.innerHTML =
    `<option value="">All clients</option>` +
    clientFilterOptions.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  els.listFilterClient.value = viewState.clientFilter || "";

  els.clientList.querySelectorAll(".client-row").forEach((row) => {
    const clientId = row.dataset.clientId;
    row.querySelector('[data-action="filter"]').addEventListener("click", () => {
      viewState.clientFilter = viewState.clientFilter === clientId ? null : clientId;
      renderClientList();
      renderCurrentView();
    });
    row.querySelector('[data-action="add-item"]').addEventListener("click", () => openItemModal(clientId));
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openClientModal(clientId));
    row.querySelector('[data-action="delete"]')?.addEventListener("click", () => confirmDeleteClient(clientId));
  });
}

function renderCategoryFilterOptions() {
  // Union of the master category list plus any category actually in use (covers custom labels
  // that were typed in rather than picked from the list) -- sorted for a stable dropdown order.
  const inUse = new Set(latestState.categories);
  for (const item of latestState.items.values()) inUse.add(item.category);
  const options = [...inUse].sort((a, b) => a.localeCompare(b));

  els.filterCategory.innerHTML =
    `<option value="">All categories</option>` +
    options.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  els.filterCategory.value = viewState.categoryFilter || "";
}

// ---- modals ------------------------------------------------------------

// wide: true widens #modal-content for the letter field-placement/signing screens, which embed
// a rendered PDF page and need real room -- the default 480px max-width (right for every other
// modal in the app) would make those unusable.
function openModal(html, { wide } = {}) {
  qs("modal-content").innerHTML = html;
  qs("modal-content").classList.toggle("modal-content-wide", !!wide);
  qs("modal-backdrop").hidden = false;
}

function closeModal() {
  qs("modal-backdrop").hidden = true;
  qs("modal-content").innerHTML = "";
  qs("modal-content").classList.remove("modal-content-wide");
}

function openClientModal(clientId) {
  const client = clientId ? latestState.clients.get(clientId) : null;
  openModal(`
    <h2>${client ? "Edit client" : "Add client"}</h2>
    <form id="client-form">
      <label>Name<br/><input type="text" id="client-name" required value="${client ? escapeHtml(client.name) : ""}" /></label>
      <label>Notes (optional)<br/><textarea id="client-notes">${client ? escapeHtml(client.notes || "") : ""}</textarea></label>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        ${
          client
            ? `<button type="button" class="btn" data-action="toggle-archive">${client.archived ? "Restore client" : "Archive client"}</button>`
            : ""
        }
        <button type="submit" class="btn btn-primary">${client ? "Save" : "Add client"}</button>
      </div>
    </form>
  `);
  qs("client-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = qs("client-name").value.trim();
    const notes = qs("client-notes").value.trim();
    if (!name) return;
    try {
      if (client) await updateClient(clientId, { name, notes });
      else await addClient(name, notes);
      closeModal();
    } catch (err) {
      alert("Could not save client: " + err.message);
    }
  });
  if (client) {
    qs("modal-content").querySelector('[data-action="toggle-archive"]').addEventListener("click", async () => {
      try {
        await setClientArchived(clientId, !client.archived);
        closeModal();
      } catch (err) {
        alert("Could not update client: " + err.message);
      }
    });
  }
  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

function confirmDeleteClient(clientId) {
  const client = latestState.clients.get(clientId);
  const itemCount = [...latestState.items.values()].filter((i) => i.clientId === clientId).length;
  openModal(`
    <h2>Delete ${escapeHtml(client.name)}?</h2>
    <p>This permanently deletes this client, its ${itemCount} item(s), and all completion history. This cannot be undone.</p>
    <label class="confirm-checkbox"><input type="checkbox" id="confirm-delete-check" /> I understand, delete this client</label>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="cancel">Cancel</button>
      <button type="button" class="btn btn-danger" id="confirm-delete-btn" disabled>Delete permanently</button>
    </div>
  `);
  qs("confirm-delete-check").addEventListener("change", (e) => {
    qs("confirm-delete-btn").disabled = !e.target.checked;
  });
  qs("confirm-delete-btn").addEventListener("click", async () => {
    try {
      await deleteClientCascade(clientId);
      if (viewState.clientFilter === clientId) viewState.clientFilter = null;
      closeModal();
    } catch (err) {
      alert("Could not delete client: " + err.message);
    }
  });
  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

function openItemModal(clientId, itemId, defaultStartDate) {
  const item = itemId ? latestState.items.get(itemId) : null;
  const categories = latestState.categories;
  const client = latestState.clients.get(clientId);

  openModal(`
    <h2>${item ? "Edit item" : "Add item"} — ${escapeHtml(client.name)}</h2>
    <div id="item-form-error" class="auth-error" hidden></div>
    ${item && item.priorRule ? `<p class="recurrence-history-note">Currently: ${escapeHtml(describeRecurrenceHistory(item))}</p>` : ""}
    <form id="item-form">
      <label>Category<br/>
        <select id="item-category">
          ${categories.map((c) => `<option value="${escapeHtml(c)}" ${item && item.category === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          <option value="__custom__" ${item && !categories.includes(item.category) ? "selected" : ""}>Custom…</option>
        </select>
      </label>
      <label id="custom-label-wrap" ${item && !categories.includes(item.category) ? "" : "hidden"}>
        Custom label<br/><input type="text" id="item-custom-label" value="${item ? escapeHtml(item.customLabel || item.category) : ""}" />
      </label>
      <label>Start date<br/><input type="date" id="item-start-date" required value="${item ? item.startDate : defaultStartDate || toISODate(new Date())}" /></label>
      <label>Recurrence<br/>
        <select id="item-recurrence-type">
          <option value="monthly" ${item && item.recurrenceType === "monthly" ? "selected" : ""}>Monthly</option>
          <option value="quarterly" ${item && item.recurrenceType === "quarterly" ? "selected" : ""}>Quarterly</option>
          <option value="annually" ${item && item.recurrenceType === "annually" ? "selected" : ""}>Annually</option>
          <option value="custom" ${item && item.recurrenceType === "custom" ? "selected" : ""}>Custom (every N months)</option>
        </select>
      </label>
      <label id="interval-wrap" ${item && item.recurrenceType === "custom" ? "" : "hidden"}>
        Every N months<br/><input type="number" id="item-interval" min="1" value="${item ? item.recurrenceInterval || 1 : 1}" />
      </label>
      <label>Day of month (optional, defaults to start date's day)<br/>
        <input type="number" id="item-day-of-month" min="1" max="31" value="${item && item.recurrenceDayOfMonth ? item.recurrenceDayOfMonth : ""}" />
      </label>
      ${
        item
          ? `<label>Recurrence change effective from (optional)<br/>
        <input type="date" id="item-recurrence-effective-from" value="${item.currentRuleEffectiveFrom || ""}" />
        <small>Only fill this in if the frequency above is genuinely changing (e.g. monthly &rarr;
        quarterly) starting some month -- everything before that month keeps using whatever this
        item's recurrence was set to before this edit, only the new occurrences from that month on
        use what you just entered above. Leave blank for a plain correction that applies to the
        whole item, past and future.</small>
      </label>`
          : ""
      }
      <div class="modal-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        ${item ? `<button type="button" class="btn btn-danger" data-action="remove">Remove item</button>` : ""}
        <button type="submit" class="btn btn-primary">${item ? "Save" : "Add item"}</button>
      </div>
    </form>
  `);

  qs("item-category").addEventListener("change", (e) => {
    qs("custom-label-wrap").hidden = e.target.value !== "__custom__";
  });
  qs("item-recurrence-type").addEventListener("change", (e) => {
    qs("interval-wrap").hidden = e.target.value !== "custom";
  });

  qs("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const categorySelect = qs("item-category").value;
    const isCustomCategory = categorySelect === "__custom__";
    const customLabel = isCustomCategory ? qs("item-custom-label").value.trim() : null;
    const category = isCustomCategory ? customLabel : categorySelect;
    const startDate = qs("item-start-date").value;
    const recurrenceType = qs("item-recurrence-type").value;
    const recurrenceInterval = recurrenceType === "custom" ? Number(qs("item-interval").value) || 1 : null;
    const dayOfMonthRaw = qs("item-day-of-month").value;
    const recurrenceDayOfMonth = dayOfMonthRaw ? Number(dayOfMonthRaw) : null;

    if (!category || !startDate) return;

    const label = customLabel || category;
    const normalizedLabel = label.trim().toLowerCase();
    if (labelAlreadyOnClient(clientId, normalizedLabel, itemId)) {
      const errorEl = qs("item-form-error");
      errorEl.textContent = `${client.name} already has an item called "${label}". Edit the existing one instead of adding a duplicate.`;
      errorEl.hidden = false;
      return;
    }

    const itemData = {
      category,
      customLabel,
      startDate,
      recurrenceType,
      recurrenceInterval,
      recurrenceDayOfMonth,
      recurrenceCustomRule: null,
    };

    // A recurrence change only splits the item's history if an effective-from date was given.
    // Otherwise this is a plain correction, applying to the whole item -- clear any earlier split.
    if (item) {
      const effectiveFrom = qs("item-recurrence-effective-from").value || null;
      if (effectiveFrom) {
        itemData.priorRule = {
          recurrenceType: item.recurrenceType,
          recurrenceInterval: item.recurrenceInterval,
          recurrenceDayOfMonth: item.recurrenceDayOfMonth,
        };
        itemData.currentRuleEffectiveFrom = effectiveFrom;
      } else {
        itemData.priorRule = null;
        itemData.currentRuleEffectiveFrom = null;
      }
    }

    try {
      if (item) await updateItem(clientId, itemId, itemData);
      else await addItem(clientId, itemData);
      closeModal();
    } catch (err) {
      alert("Could not save item: " + err.message);
    }
  });

  if (item) {
    qs("modal-content").querySelector('[data-action="remove"]').addEventListener("click", async () => {
      if (!confirm("Remove this item and its completion history?")) return;
      try {
        await deleteItem(clientId, itemId);
        closeModal();
      } catch (err) {
        alert("Could not remove item: " + err.message);
      }
    });
  }
  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

function labelAlreadyOnClient(clientId, normalizedLabel, excludeItemId) {
  return [...latestState.items.values()].some(
    (existing) =>
      existing.clientId === clientId &&
      existing.id !== excludeItemId &&
      (existing.customLabel || existing.category).trim().toLowerCase() === normalizedLabel
  );
}

function openBulkAddItemModal() {
  const categories = latestState.categories;

  openModal(`
    <h2>Add item to multiple clients</h2>
    <div id="bulk-form-error" class="auth-error" hidden></div>
    <form id="bulk-item-form">
      <label>Category<br/>
        <select id="bulk-category">
          ${categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
          <option value="__custom__">Custom…</option>
        </select>
      </label>
      <label id="bulk-custom-label-wrap" hidden>
        Custom label<br/><input type="text" id="bulk-custom-label" />
      </label>
      <label>Start date<br/><input type="date" id="bulk-start-date" required value="${toISODate(new Date())}" /></label>
      <label>Recurrence<br/>
        <select id="bulk-recurrence-type">
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annually">Annually</option>
          <option value="custom">Custom (every N months)</option>
        </select>
      </label>
      <label id="bulk-interval-wrap" hidden>
        Every N months<br/><input type="number" id="bulk-interval" min="1" value="1" />
      </label>
      <label>Day of month (optional, defaults to start date's day)<br/>
        <input type="number" id="bulk-day-of-month" min="1" max="31" />
      </label>

      <div class="bulk-clients-section">
        <div class="bulk-clients-header">
          <span>Add to which clients?</span>
          <label class="bulk-select-all-label"><input type="checkbox" id="bulk-select-all" /> Select all</label>
        </div>
        <div id="bulk-clients-list" class="bulk-clients-list"></div>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="bulk-submit-btn">Add to clients</button>
      </div>
    </form>
  `);

  function currentLabel() {
    const categorySelect = qs("bulk-category").value;
    return categorySelect === "__custom__" ? qs("bulk-custom-label").value.trim() : categorySelect;
  }

  function renderClientChecklist() {
    const label = currentLabel();
    const normalizedLabel = label.trim().toLowerCase();
    const allClients = [...latestState.clients.values()].sort((a, b) => a.name.localeCompare(b.name));
    const eligible = allClients.filter((c) => !normalizedLabel || !labelAlreadyOnClient(c.id, normalizedLabel));
    const excludedCount = allClients.length - eligible.length;

    const listEl = qs("bulk-clients-list");
    if (allClients.length === 0) {
      listEl.innerHTML = `<div class="empty-hint">No clients yet. Add a client first.</div>`;
    } else if (eligible.length === 0) {
      listEl.innerHTML = `<div class="empty-hint">Every client already has an item called "${escapeHtml(label)}".</div>`;
    } else {
      const excludedNote =
        excludedCount > 0
          ? `<div class="bulk-excluded-note">${excludedCount} client${excludedCount === 1 ? "" : "s"} already ${excludedCount === 1 ? "has" : "have"} this item and ${excludedCount === 1 ? "isn't" : "aren't"} shown.</div>`
          : "";
      listEl.innerHTML =
        eligible
          .map(
            (c) => `
        <label class="bulk-client-row">
          <input type="checkbox" class="bulk-client-checkbox" value="${c.id}" />
          <span class="client-dot" style="background:${colorFor(c.id)}"></span>
          ${escapeHtml(c.name)}
        </label>`
          )
          .join("") + excludedNote;
    }
    qs("bulk-select-all").checked = false;
  }

  qs("bulk-category").addEventListener("change", (e) => {
    qs("bulk-custom-label-wrap").hidden = e.target.value !== "__custom__";
    renderClientChecklist();
  });
  qs("bulk-recurrence-type").addEventListener("change", (e) => {
    qs("bulk-interval-wrap").hidden = e.target.value !== "custom";
  });
  qs("bulk-custom-label-wrap").addEventListener("input", renderClientChecklist);
  qs("bulk-select-all").addEventListener("change", (e) => {
    qs("bulk-clients-list")
      .querySelectorAll(".bulk-client-checkbox")
      .forEach((cb) => (cb.checked = e.target.checked));
  });

  renderClientChecklist();

  qs("bulk-item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const categorySelect = qs("bulk-category").value;
    const isCustomCategory = categorySelect === "__custom__";
    const customLabel = isCustomCategory ? qs("bulk-custom-label").value.trim() : null;
    const category = isCustomCategory ? customLabel : categorySelect;
    const startDate = qs("bulk-start-date").value;
    const recurrenceType = qs("bulk-recurrence-type").value;
    const recurrenceInterval = recurrenceType === "custom" ? Number(qs("bulk-interval").value) || 1 : null;
    const dayOfMonthRaw = qs("bulk-day-of-month").value;
    const recurrenceDayOfMonth = dayOfMonthRaw ? Number(dayOfMonthRaw) : null;

    if (!category || !startDate) return;

    const selectedClientIds = [...qs("bulk-clients-list").querySelectorAll(".bulk-client-checkbox:checked")].map(
      (cb) => cb.value
    );
    if (selectedClientIds.length === 0) {
      const errorEl = qs("bulk-form-error");
      errorEl.textContent = "Select at least one client.";
      errorEl.hidden = false;
      return;
    }

    const itemData = {
      category,
      customLabel,
      startDate,
      recurrenceType,
      recurrenceInterval,
      recurrenceDayOfMonth,
      recurrenceCustomRule: null,
    };

    const submitBtn = qs("bulk-submit-btn");
    submitBtn.disabled = true;
    try {
      for (const clientId of selectedClientIds) {
        await addItem(clientId, itemData);
      }
      closeModal();
    } catch (err) {
      alert("Could not add item to every selected client: " + err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

function openDayModal(date, entries) {
  const label = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  openModal(`
    <h2>${label}</h2>
    ${entries.length === 0 ? "<p>Nothing due.</p>" : ""}
    <div id="day-modal-rows"></div>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="close">Close</button>
      <button type="button" class="btn" data-action="add-item">Add item to a client</button>
    </div>
  `);

  const rowsContainer = qs("day-modal-rows");
  renderDayRows(rowsContainer, entries);

  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);
  qs("modal-content").querySelector('[data-action="add-item"]').addEventListener("click", () => {
    openAddItemForDateModal(date);
  });
}

// Lets the user pick which client to add an item for, then opens the normal item form
// pre-filled with the date that was actually clicked -- rather than silently defaulting to
// today's date and an arbitrary first client, which is what a bare "open the add-item form"
// call would otherwise do.
function openAddItemForDateModal(date) {
  const clients = [...latestState.clients.values()]
    .filter((c) => !c.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (clients.length === 0) {
    alert("Add a client first.");
    return;
  }
  const label = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  openModal(`
    <h2>Add item due ${label}</h2>
    <form id="pick-client-form">
      <label>Client<br/>
        <select id="pick-client-select">
          ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </label>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">Continue</button>
      </div>
    </form>
  `);
  qs("pick-client-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const clientId = qs("pick-client-select").value;
    openItemModal(clientId, null, toISODate(date));
  });
  qs("modal-content").querySelector('[data-action="cancel"]').addEventListener("click", closeModal);
}

function renderDayRows(container, entries) {
  if (entries.length === 0) return;
  container.innerHTML = entries
    .map(({ item, periodKey }) => {
      const client = latestState.clients.get(item.clientId);
      const forItem = latestState.completions.get(item.id);
      const done = !!(forItem && forItem.has(periodKey));
      const label = item.customLabel || item.category;
      return `
      <div class="list-row">
        <label style="display:flex; align-items:center; gap:0.6rem; flex:1; cursor:pointer;">
          <input type="checkbox" data-item-id="${item.id}" data-client-id="${item.clientId}" data-period-key="${periodKey}" ${done ? "checked" : ""} />
          <span class="list-row-dot" style="background:${colorFor(item.clientId)}"></span>
          <span class="list-row-client">${escapeHtml(client ? client.name : "?")}</span>
          <span class="list-row-label">${escapeHtml(label)}</span>
          <span class="list-row-recurrence">${describeRecurrence(item)}</span>
        </label>
        <button class="icon-btn" data-action="edit-item" data-item-id="${item.id}" data-client-id="${item.clientId}" title="Edit or remove item">${iconEdit}</button>
      </div>`;
    })
    .join("");

  container.querySelectorAll('[data-action="edit-item"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      openItemModal(btn.dataset.clientId, btn.dataset.itemId);
    });
  });

  container.querySelectorAll("input[type=checkbox]").forEach((el) => {
    el.addEventListener("change", () => {
      const { itemId, clientId, periodKey } = el.dataset;
      handleToggleComplete(clientId, itemId, periodKey, el.checked);
    });
  });
}

function openCategoriesModal() {
  const categories = [...latestState.categories];
  renderCategoriesModal(categories);
}

function renderCategoriesModal(categories) {
  openModal(`
    <h2>Manage categories</h2>
    <ul class="category-list">
      ${categories
        .map(
          (c, i) => `<li>${escapeHtml(c)} <button class="icon-btn" data-remove-index="${i}" title="Remove">✕</button></li>`
        )
        .join("")}
    </ul>
    <form id="add-category-form">
      <input type="text" id="new-category-name" placeholder="New category name" />
      <button type="submit" class="btn">Add</button>
    </form>
    <div class="modal-actions">
      <button type="button" class="btn" data-action="close">Close</button>
    </div>
  `);

  qs("modal-content").querySelectorAll("[data-remove-index]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = categories.filter((_, i) => i !== Number(btn.dataset.removeIndex));
      await saveCategories(next);
      renderCategoriesModal(next);
    });
  });

  qs("add-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = qs("new-category-name").value.trim();
    if (!name || categories.includes(name)) return;
    const next = [...categories, name];
    await saveCategories(next);
    renderCategoriesModal(next);
  });

  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);
}

function openExportInfo() {
  const url = `https://github.com/${githubRepoSlug}/actions/workflows/backup.yml`;
  openModal(`
    <h2>Export a snapshot to GitHub</h2>
    <p>Snapshots run automatically every day. To take one right now (e.g. before a big change),
    open the backup workflow on GitHub and click <strong>"Run workflow"</strong>. This requires being
    signed in to GitHub with access to the repo — it's kept separate from this app on purpose, since the
    backup process needs a Firebase admin key that must never be shipped to the browser.</p>
    <div class="modal-actions">
      <a class="btn btn-primary" href="${url}" target="_blank" rel="noopener">Open backup workflow on GitHub</a>
      <button type="button" class="btn" data-action="close">Close</button>
    </div>
  `);
  qs("modal-content").querySelector('[data-action="close"]').addEventListener("click", closeModal);
}

init();
