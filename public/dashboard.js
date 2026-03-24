const queryForm = document.getElementById("query-form");
const queryInput = document.getElementById("query");
const responseText = document.getElementById("response-text");
const banner = document.getElementById("banner");
const userName = document.getElementById("user-name");
const orgName = document.getElementById("org-name");
const orgRole = document.getElementById("org-role");
const orgSlug = document.getElementById("org-slug");
const statusPill = document.getElementById("status-pill");
const historyList = document.getElementById("history-list");
const membersList = document.getElementById("members-list");
const inviteList = document.getElementById("invite-list");
const auditList = document.getElementById("audit-list");
const jobsList = document.getElementById("jobs-list");
const memberCount = document.getElementById("member-count");
const queryCount = document.getElementById("query-count");
const auditCount = document.getElementById("audit-count");
const logoutButton = document.getElementById("logout-button");
const useExampleButton = document.getElementById("use-example");
const orgSelector = document.getElementById("org-selector");
const inviteForm = document.getElementById("invite-form");
const settingsForm = document.getElementById("settings-form");
const jiraForm = document.getElementById("jira-form");
const githubForm = document.getElementById("github-form");
const teamMembersJson = document.getElementById("team-members-json");
const trackedReposJson = document.getElementById("tracked-repos-json");
const jiraSecretRef = document.getElementById("jira-secret-ref");
const githubSecretRef = document.getElementById("github-secret-ref");
const jiraEnabled = document.getElementById("jira-enabled");
const githubEnabled = document.getElementById("github-enabled");
const jiraStatus = document.getElementById("jira-status");
const githubStatus = document.getElementById("github-status");

const exampleQueries = [
  "What is John working on these days?",
  "Show me recent activity for Sarah",
  "What has Mike been working on this week?",
  "Show me Lisa's recent pull requests"
];

let exampleIndex = 0;
let csrfToken = null;
let currentOrganizationId = null;
let organizations = [];

function setBanner(message, type = "warning") {
  if (!message) {
    banner.textContent = "";
    banner.className = "dashboard-banner hidden";
    return;
  }

  banner.textContent = message;
  banner.className = `dashboard-banner ${type}`;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (!["GET", "HEAD"].includes(options.method || "GET")) {
    headers.set("x-csrf-token", csrfToken || "");
  }

  const response = await fetch(path, {
    ...options,
    headers
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

function renderDataList(element, items, emptyMessage, formatter) {
  if (!items || items.length === 0) {
    element.innerHTML = `<p class="history-empty">${emptyMessage}</p>`;
    return;
  }

  element.innerHTML = items.map(formatter).join("");
}

function renderHistory(items) {
  queryCount.textContent = String(items.length);
  renderDataList(
    historyList,
    items,
    "Workspace query history will appear here.",
    (item) => `
      <article class="history-item">
        <button class="history-replay" data-query="${item.queryText.replace(/"/g, "&quot;")}">Reuse</button>
        <p class="history-query">${item.queryText}</p>
        <p class="history-time">${new Date(item.createdAt).toLocaleString()}</p>
        <pre class="history-response">${item.responseText}</pre>
      </article>
    `
  );

  document.querySelectorAll(".history-replay").forEach((button) => {
    button.addEventListener("click", () => {
      queryInput.value = button.dataset.query || "";
      queryInput.focus();
    });
  });
}

function renderMembers(items) {
  memberCount.textContent = String(items.length);
  renderDataList(
    membersList,
    items,
    "Members will appear here.",
    (item) => `
      <article class="data-card">
        <strong>${item.name}</strong>
        <p>${item.email}</p>
        <span class="pill">${item.role}</span>
      </article>
    `
  );
}

function renderInvitations(items) {
  renderDataList(
    inviteList,
    items,
    "Recent invitations will appear here.",
    (item) => `
      <article class="data-card">
        <strong>${item.email}</strong>
        <p>Role: ${item.role}</p>
        <p>Expires: ${new Date(item.expiresAt).toLocaleString()}</p>
        <a class="invite-link" href="${item.inviteUrl}">${item.inviteUrl}</a>
      </article>
    `
  );
}

function renderAuditEvents(items) {
  auditCount.textContent = String(items.length);
  renderDataList(
    auditList,
    items,
    "Audit events will appear here.",
    (item) => `
      <article class="data-card">
        <strong>${item.eventType}</strong>
        <p>${item.actorName || "System"} · ${new Date(item.createdAt).toLocaleString()}</p>
        <pre class="compact-pre">${JSON.stringify(item.metadata, null, 2)}</pre>
      </article>
    `
  );
}

function renderJobs(items) {
  renderDataList(
    jobsList,
    items,
    "Queued jobs will appear here.",
    (item) => `
      <article class="data-card">
        <strong>${item.jobType}</strong>
        <p>Status: ${item.status}</p>
        <pre class="compact-pre">${JSON.stringify(item.payload, null, 2)}</pre>
      </article>
    `
  );
}

function renderOrganizations() {
  orgSelector.innerHTML = organizations
    .map(
      (organization) => `
        <option value="${organization.id}" ${organization.id === currentOrganizationId ? "selected" : ""}>
          ${organization.name}
        </option>
      `
    )
    .join("");
}

async function loadSession() {
  const payload = await api("/api/v1/auth/session");

  if (!payload.authenticated) {
    window.location.href = "/login";
    return;
  }

  csrfToken = payload.csrfToken;
  organizations = payload.organizations || [];
  currentOrganizationId = payload.currentOrganization?.id || organizations[0]?.id || null;

  userName.textContent = payload.user.name;
  orgName.textContent = payload.currentOrganization?.name || "No organization";
  orgRole.textContent = payload.currentOrganization
    ? `Role: ${payload.currentOrganization.role}`
    : "Role unavailable";
  orgSlug.textContent = payload.currentOrganization?.slug || "-";
  renderOrganizations();
}

async function loadWorkspaceData() {
  if (!currentOrganizationId) {
    setBanner("No active organization is available.", "error");
    return;
  }

  const [members, invitations, integrations, settings, history, auditEvents, jobs] =
    await Promise.all([
      api(`/api/v1/orgs/${currentOrganizationId}/members`),
      api(`/api/v1/orgs/${currentOrganizationId}/invitations`),
      api(`/api/v1/orgs/${currentOrganizationId}/integrations`),
      api(`/api/v1/orgs/${currentOrganizationId}/settings`),
      api(`/api/v1/orgs/${currentOrganizationId}/query-runs`),
      api(`/api/v1/orgs/${currentOrganizationId}/audit-events`),
      api(`/api/v1/orgs/${currentOrganizationId}/background-jobs`)
    ]);

  renderMembers(members.items);
  renderInvitations(invitations.items);
  renderHistory(history.items);
  renderAuditEvents(auditEvents.items);
  renderJobs(jobs.items);

  teamMembersJson.value = JSON.stringify(settings.teamMembers, null, 2);
  trackedReposJson.value = JSON.stringify(settings.trackedRepos, null, 2);

  jiraSecretRef.value = integrations.jira.secretRef || "";
  jiraEnabled.checked = integrations.jira.enabled;
  jiraStatus.textContent = `Status: ${integrations.jira.status}${integrations.jira.lastValidatedAt ? ` · validated ${new Date(integrations.jira.lastValidatedAt).toLocaleString()}` : ""}`;

  githubSecretRef.value = integrations.github.secretRef || "";
  githubEnabled.checked = integrations.github.enabled;
  githubStatus.textContent = `Status: ${integrations.github.status}${integrations.github.lastValidatedAt ? ` · validated ${new Date(integrations.github.lastValidatedAt).toLocaleString()}` : ""}`;

  const currentOrganization = organizations.find((organization) => organization.id === currentOrganizationId);
  orgName.textContent = currentOrganization?.name || "No organization";
  orgRole.textContent = currentOrganization ? `Role: ${currentOrganization.role}` : "Role unavailable";
  orgSlug.textContent = currentOrganization?.slug || "-";
}

async function runQuery(event) {
  event.preventDefault();

  const query = queryInput.value.trim();
  if (!query) {
    setBanner("Enter a question before submitting.", "warning");
    return;
  }

  statusPill.textContent = "Running";
  responseText.textContent = "Loading grounded activity data...";
  setBanner("");

  try {
    const payload = await api(`/api/v1/orgs/${currentOrganizationId}/query`, {
      method: "POST",
      body: JSON.stringify({ query })
    });

    responseText.textContent = payload.responseText;

    if (payload.summary?.needsClarification) {
      setBanner(payload.summary.clarificationReason || "Clarification is required.", "warning");
    } else if (payload.partialData) {
      setBanner("Answer generated with partial provider data. Review connector status below.", "warning");
    } else if (payload.summary?.caveats?.length) {
      setBanner(payload.summary.caveats[0], "warning");
    } else {
      setBanner("Answer generated and saved to workspace history.", "success");
    }

    statusPill.textContent = "Ready";
    await loadWorkspaceData();
  } catch (error) {
    responseText.textContent = "The query could not be completed.";
    statusPill.textContent = "Error";
    setBanner(error instanceof Error ? error.message : "Unexpected error.", "error");
  }
}

async function switchOrganization() {
  const organizationId = orgSelector.value;

  try {
    const payload = await api("/api/v1/auth/switch-organization", {
      method: "POST",
      body: JSON.stringify({ organizationId })
    });

    currentOrganizationId = payload.currentOrganization?.id || organizationId;
    organizations = payload.organizations || organizations;
    renderOrganizations();
    await loadWorkspaceData();
    setBanner("Workspace switched.", "success");
  } catch (error) {
    setBanner(error instanceof Error ? error.message : "Could not switch organization.", "error");
  }
}

async function saveConnector(provider) {
  const payload =
    provider === "jira"
      ? {
          secretRef: jiraSecretRef.value.trim(),
          enabled: jiraEnabled.checked
        }
      : {
          secretRef: githubSecretRef.value.trim(),
          enabled: githubEnabled.checked
        };

  await api(`/api/v1/orgs/${currentOrganizationId}/integrations/${provider}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });

  await loadWorkspaceData();
  setBanner(`${provider === "jira" ? "Jira" : "GitHub"} connector saved.`, "success");
}

async function saveSettings(event) {
  event.preventDefault();

  try {
    await api(`/api/v1/orgs/${currentOrganizationId}/settings`, {
      method: "PUT",
      body: JSON.stringify({
        teamMembers: JSON.parse(teamMembersJson.value),
        trackedRepos: JSON.parse(trackedReposJson.value)
      })
    });

    await loadWorkspaceData();
    setBanner("Workspace settings saved.", "success");
  } catch (error) {
    setBanner(error instanceof Error ? error.message : "Could not save workspace settings.", "error");
  }
}

async function createInvite(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(inviteForm).entries());

  try {
    await api(`/api/v1/orgs/${currentOrganizationId}/invitations`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    inviteForm.reset();
    await loadWorkspaceData();
    setBanner("Invitation created.", "success");
  } catch (error) {
    setBanner(error instanceof Error ? error.message : "Could not create invitation.", "error");
  }
}

async function logout() {
  await api("/api/v1/auth/logout", { method: "POST" });
  window.location.href = "/";
}

queryForm.addEventListener("submit", runQuery);
logoutButton.addEventListener("click", logout);
useExampleButton.addEventListener("click", () => {
  exampleIndex = (exampleIndex + 1) % exampleQueries.length;
  queryInput.value = exampleQueries[exampleIndex];
});
orgSelector.addEventListener("change", switchOrganization);
inviteForm.addEventListener("submit", createInvite);
settingsForm.addEventListener("submit", saveSettings);
jiraForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveConnector("jira");
});
githubForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveConnector("github");
});

Promise.resolve()
  .then(loadSession)
  .then(loadWorkspaceData)
  .catch((error) => {
    setBanner(error instanceof Error ? error.message : "Dashboard failed to load.", "error");
  });
