import { isFirebaseConfigured, auth } from "./firebase-init.js?v=1788734871664";
import {
  watchAuthState,
  signInWithPassword,
  sendEmailLink,
  completeEmailLinkSignInIfPresent,
  signOutUser,
  getOwnProfile,
} from "./auth.js?v=1788734871664";
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
} from "./data.js?v=1788734871664";
import { renderCalendar } from "./calendar-view.js?v=1788734871664";
import { renderList } from "./list-view.js?v=1788734871664";
import { describeRecurrence, describeRecurrenceHistory, getLastDueOccurrence, toISODate } from "./recurrence.js?v=1788734871664";
import { colorFor } from "./colors.js?v=1788734871664";
import { githubRepoSlug } from "./firebase-config.js?v=1788734871664";
import { iconEdit, iconTrash, iconPlus, iconPlusLarge, iconCheck, iconTag, iconUpload, iconLogout, iconCalendar, iconListView, iconFolder, iconFolderLarge } from "./icons.js?v=1788734871664";

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
  view: localStorage.getItem("cct_view") || "calendar",
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  colorMode: localStorage.getItem("cct_colormode") || "client",
  clientFilter: null,
  categoryFilter: null,
  clientSearch: "",
  showArchived: false,
};

let currentListRows = []; // rows currently rendered (unfiltered by completion) by the list view

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
  els.viewToggleCalendar = qs("view-toggle-calendar");
  els.viewToggleList = qs("view-toggle-list");
  els.viewToggleClientHub = qs("view-toggle-clienthub");
  els.listFilterClient = qs("list-filter-client");
  els.filterCategory = qs("filter-category");
  els.markAllCompleteBtn = qs("mark-all-complete-btn");
  els.userEmail = qs("user-email");
  els.clientHubScreen = qs("client-hub-screen");
  els.clientHubName = qs("client-hub-name");

  if (!isFirebaseConfigured) {
    els.configWarning.hidden = false;
    els.authScreen.hidden = true;
    return;
  }

  // Icon + label markup so these can collapse to icon-only on narrow screens (see .btn-header
  // in styles.css) without duplicating the icon set into static HTML.
  qs("manage-categories-btn").innerHTML = `<span class="btn-header-icon">${iconTag}</span><span class="btn-header-label">Manage categories</span>`;
  qs("export-btn").innerHTML = `<span class="btn-header-icon">${iconUpload}</span><span class="btn-header-label">Export to GitHub</span>`;
  qs("sign-out-btn").innerHTML = `<span class="btn-header-icon">${iconLogout}</span><span class="btn-header-label">Sign out</span>`;
  qs("view-toggle-calendar").innerHTML = `${iconCalendar}<span>Calendar</span>`;
  qs("view-toggle-list").innerHTML = `${iconListView}<span>List</span>`;
  qs("view-toggle-clienthub").innerHTML = `${iconFolder}<span>Client Hub</span>`;
  qs("client-hub-icon").innerHTML = iconFolderLarge;

  wireAuthForms();
  wireToolbar();
  wireClientHubScreen();

  completeEmailLinkSignInIfPresent().catch((err) => alert("Sign-in link failed: " + err.message));

  watchAuthState(async (user) => {
    if (!user) {
      els.authScreen.hidden = false;
      els.appShell.hidden = true;
      els.clientHubScreen.hidden = true;
      stopSync();
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
    } else {
      els.clientHubScreen.hidden = true;
      els.appShell.hidden = false;
      els.userEmail.textContent = user.email;
      startSync();
      seedCategoriesIfMissing(DEFAULT_CATEGORIES).catch((err) => console.error(err));
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
      showAuthError(err.message);
    }
  });

  qs("email-link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = qs("auth-email-link").value.trim();
    try {
      await sendEmailLink(email);
      qs("email-link-status").textContent = `Sign-in link sent to ${email}. Check your inbox.`;
    } catch (err) {
      showAuthError(err.message);
    }
  });

  qs("sign-out-btn").addEventListener("click", () => signOutUser());
}

function showAuthError(message) {
  const el = qs("auth-error");
  el.textContent = message;
  el.hidden = false;
}

// ---- toolbar / view switching ----------------------------------------------

function wireToolbar() {
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
  els.viewToggleCalendar.classList.toggle("active", view === "calendar");
  els.viewToggleList.classList.toggle("active", view === "list");
  els.viewToggleClientHub.classList.toggle("active", view === "clienthub");
  qs("list-filter-wrap").hidden = view !== "list";
  els.markAllCompleteBtn.hidden = view !== "list";
  renderCurrentView();
}

function renderCurrentView() {
  if (viewState.view === "clienthub") {
    renderClientHubStaffView();
    return;
  }
  if (!isFullyLoaded()) {
    els.viewContainer.innerHTML = `<div class="loading-hint"><span class="spinner"></span> Loading…</div>`;
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

// ---- client hub (staff-side placeholder; document review lands in Milestone 2) --------------

function renderClientHubStaffView() {
  els.viewContainer.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-badge empty-state-badge-primary">${iconFolderLarge}</div>
      <h3>Client Hub</h3>
      <p>Document intake, e-signature, and engagement letters land here in Milestones 2-5.
      For now, give a client Client Hub access by creating their Firebase Auth account and a
      matching <code>/users/{uid}</code> document with <code>role: "client"</code> and
      <code>clientId</code> set to their client record's ID -- see the README.</p>
    </div>`;
}

// ---- client hub (client-facing screen) --------------------------------------------------

function wireClientHubScreen() {
  qs("client-hub-signout-btn").addEventListener("click", () => signOutUser());
}

async function showClientHub(profile) {
  els.clientHubScreen.hidden = false;
  els.clientHubName.textContent = "";
  if (!profile.clientId) {
    els.clientHubName.textContent = " -- ask your accountant to finish setting up your account (missing clientId).";
    return;
  }
  try {
    const client = await getClientRecord(profile.clientId);
    els.clientHubName.textContent = client ? `, ${client.name}` : "";
  } catch (err) {
    console.error(err);
  }
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

function openModal(html) {
  qs("modal-content").innerHTML = html;
  qs("modal-backdrop").hidden = false;
}

function closeModal() {
  qs("modal-backdrop").hidden = true;
  qs("modal-content").innerHTML = "";
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

init();
