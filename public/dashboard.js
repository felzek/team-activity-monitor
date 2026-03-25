const queryForm = document.getElementById("query-form");
const queryInput = document.getElementById("query");
const responseText = document.getElementById("response-text");
const responseShell = document.getElementById("response-shell");
const responseEmpty = document.getElementById("response-empty");
const responseStructured = document.getElementById("response-structured");
const banner = document.getElementById("banner");
const userName = document.getElementById("user-name");
const orgName = document.getElementById("org-name");
const orgRole = document.getElementById("org-role");
const orgSlug = document.getElementById("org-slug");
const statusPill = document.getElementById("status-pill");
const lastUpdated = document.getElementById("last-updated");
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
const workspaceJiraHealth = document.getElementById("workspace-jira-health");
const workspaceGitHubHealth = document.getElementById("workspace-github-health");
const workspaceJiraMeta = document.getElementById("workspace-jira-meta");
const workspaceGitHubMeta = document.getElementById("workspace-github-meta");
const summaryTitle = document.getElementById("summary-title");
const summaryOverview = document.getElementById("summary-overview");
const summaryJiraIssues = document.getElementById("summary-jira-issues");
const summaryJiraUpdates = document.getElementById("summary-jira-updates");
const summaryGitHubSignals = document.getElementById("summary-github-signals");
const summaryRepos = document.getElementById("summary-repos");
const sourceStatusList = document.getElementById("source-status-list");
const jiraResults = document.getElementById("jira-results");
const githubResults = document.getElementById("github-results");
const caveatsList = document.getElementById("caveats-list");

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function summarizeText(text, maxLength = 180) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function humanizeStatus(value) {
  return String(value ?? "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function setBanner(message, type = "warning") {
  if (!message) {
    banner.textContent = "";
    banner.className = "dashboard-banner hidden";
    return;
  }

  banner.textContent = message;
  banner.className = `dashboard-banner ${type}`;
}

function setStatus(text, state = "ready") {
  statusPill.textContent = text;
  statusPill.dataset.state = state;
}

function setMetricValue(element, value) {
  element.textContent = value;
}

function renderEmptyResponse(title, body) {
  responseShell.classList.add("is-empty");
  responseShell.classList.remove("is-loading");
  responseEmpty.classList.remove("hidden");
  responseStructured.classList.add("hidden");
  responseEmpty.innerHTML = `
    <p class="eyebrow">Ready for a question</p>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(body)}</p>
  `;
}

function renderLoadingResponse(query) {
  responseShell.classList.remove("is-empty");
  responseShell.classList.add("is-loading");
  responseEmpty.classList.add("hidden");
  responseStructured.classList.remove("hidden");
  summaryTitle.textContent = "Searching Jira and GitHub...";
  summaryOverview.textContent = `Running: "${query}"`;
  setMetricValue(summaryJiraIssues, "...");
  setMetricValue(summaryJiraUpdates, "...");
  setMetricValue(summaryGitHubSignals, "...");
  setMetricValue(summaryRepos, "...");
  sourceStatusList.innerHTML = `
    <article class="source-status-card tone-neutral">
      <p class="card-label">Provider status</p>
      <strong>Checking workspace connectors</strong>
      <p class="source-meta">The app is resolving identity and collecting upstream activity.</p>
    </article>
  `;
  jiraResults.innerHTML = `
    <article class="result-card state-card tone-neutral">
      <h4>Loading Jira activity</h4>
      <p>Fetching assigned issues and recent updates for the selected timeframe.</p>
    </article>
  `;
  githubResults.innerHTML = `
    <article class="result-card state-card tone-neutral">
      <h4>Loading GitHub activity</h4>
      <p>Collecting commits, pull requests, and recently touched repositories.</p>
    </article>
  `;
  caveatsList.innerHTML = "<li>Waiting for provider responses.</li>";
  responseText.textContent = "Loading grounded activity data...";
  lastUpdated.textContent = "Fetching provider data...";
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
    element.innerHTML = `<p class="history-empty">${escapeHtml(emptyMessage)}</p>`;
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
        <button class="history-replay" data-query="${escapeHtml(item.queryText)}">Reuse</button>
        <p class="history-query">${escapeHtml(item.queryText)}</p>
        <p class="history-time">${escapeHtml(formatDateTime(item.createdAt))}</p>
        <p class="history-preview">${escapeHtml(summarizeText(item.responseText))}</p>
      </article>
    `
  );

  document.querySelectorAll(".history-replay").forEach((button) => {
    button.addEventListener("click", () => {
      queryInput.value = button.dataset.query || "";
      queryInput.focus();
      queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length);
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
        <div class="data-card-header">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="pill">${escapeHtml(item.role)}</span>
        </div>
        <p>${escapeHtml(item.email)}</p>
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
        <div class="data-card-header">
          <strong>${escapeHtml(item.email)}</strong>
          <span class="pill">${escapeHtml(item.role)}</span>
        </div>
        <p>Expires ${escapeHtml(formatDateTime(item.expiresAt))}</p>
        <a class="invite-link" href="${escapeHtml(item.inviteUrl)}">${escapeHtml(item.inviteUrl)}</a>
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
        <div class="data-card-header">
          <strong>${escapeHtml(item.eventType)}</strong>
          <span class="pill">${escapeHtml(item.actorName || "System")}</span>
        </div>
        <p>${escapeHtml(formatDateTime(item.createdAt))}</p>
        <pre class="compact-pre">${escapeHtml(JSON.stringify(item.metadata, null, 2))}</pre>
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
        <div class="data-card-header">
          <strong>${escapeHtml(item.jobType)}</strong>
          <span class="pill">${escapeHtml(item.status)}</span>
        </div>
        <pre class="compact-pre">${escapeHtml(JSON.stringify(item.payload, null, 2))}</pre>
      </article>
    `
  );
}

function renderOrganizations() {
  orgSelector.innerHTML = organizations
    .map(
      (organization) => `
        <option value="${escapeHtml(organization.id)}" ${organization.id === currentOrganizationId ? "selected" : ""}>
          ${escapeHtml(organization.name)} · ${escapeHtml(organization.role)}
        </option>
      `
    )
    .join("");
}

function renderConnectorSnapshot(connection, valueElement, metaElement) {
  const tone = !connection.enabled
    ? "muted"
    : connection.status === "connected"
      ? "success"
      : connection.status === "needs_attention"
        ? "warning"
        : "error";

  valueElement.textContent = !connection.enabled ? "Disabled" : humanizeStatus(connection.status);
  valueElement.className = `source-health-value tone-${tone}`;
  metaElement.textContent = connection.lastValidatedAt
    ? `Last validated ${formatDateTime(connection.lastValidatedAt)}`
    : connection.enabled
      ? "No successful validation has been recorded yet."
      : "Enable this connector when the workspace is ready.";
}

function connectorSummary(connector) {
  if (!connector.enabled) {
    return "Disabled for this workspace.";
  }

  if (connector.status === "connected") {
    return "Connected and available for new queries.";
  }

  if (connector.status === "needs_attention") {
    return "Connected, but this connector needs attention before the next demo.";
  }

  return "Not configured for this workspace yet.";
}

function providerTone(providerStatus, connector) {
  if (!connector.enabled) {
    return "muted";
  }

  if (!providerStatus.ok && providerStatus.errorCode !== "SKIPPED") {
    return "error";
  }

  if (providerStatus.partial || connector.status === "needs_attention") {
    return "warning";
  }

  return "success";
}

function providerHeadline(providerStatus, connector) {
  if (!connector.enabled) {
    return "Disabled";
  }

  if (providerStatus.errorCode === "SKIPPED") {
    return "Skipped";
  }

  if (!providerStatus.ok) {
    return "Unavailable";
  }

  if (providerStatus.partial) {
    return "Partial";
  }

  return "Healthy";
}

function renderSourceStatuses(summary, connectorStatus, staleData) {
  const providerEntries = [
    {
      name: "Jira",
      queryStatus: summary.jira.status,
      connector: connectorStatus.jira
    },
    {
      name: "GitHub",
      queryStatus: summary.github.status,
      connector: connectorStatus.github
    }
  ];

  sourceStatusList.innerHTML = providerEntries
    .map(({ name, queryStatus, connector }) => {
      const tone = providerTone(queryStatus, connector);
      const meta = [];

      if (connector.lastValidatedAt) {
        meta.push(`Validated ${formatDateTime(connector.lastValidatedAt)}`);
      }

      if (queryStatus.latencyMs > 0) {
        meta.push(`${queryStatus.latencyMs} ms`);
      }

      if (staleData && connector.status === "needs_attention") {
        meta.push("Review connector health");
      }

      return `
        <article class="source-status-card tone-${tone}">
          <div class="source-status-header">
            <p class="card-label">${escapeHtml(name)}</p>
            <span class="pill">${escapeHtml(providerHeadline(queryStatus, connector))}</span>
          </div>
          <strong>${escapeHtml(connectorSummary(connector))}</strong>
          <p class="source-meta">${escapeHtml(
            queryStatus.message || meta.join(" · ") || "No additional provider detail available."
          )}</p>
        </article>
      `;
    })
    .join("");
}

function stateCard(title, body, tone = "muted") {
  return `
    <article class="result-card state-card tone-${tone}">
      <h4>${escapeHtml(title)}</h4>
      <p>${escapeHtml(body)}</p>
    </article>
  `;
}

function renderJiraResults(summary) {
  if (summary.needsClarification) {
    return stateCard(
      "Need a clearer teammate match",
      summary.clarificationReason || "Clarify the teammate name before the app can run a Jira lookup.",
      "warning"
    );
  }

  if (!summary.jira.status.ok) {
    return stateCard(
      "Jira is unavailable",
      summary.jira.status.message || "The Jira lookup failed for this query.",
      "error"
    );
  }

  if (summary.jira.data.issues.length === 0) {
    return stateCard(
      "No current Jira issues",
      "No assigned Jira issues were found for this teammate in the selected timeframe.",
      "muted"
    );
  }

  return summary.jira.data.issues
    .slice(0, 5)
    .map((issue) => {
      const latestChange = issue.recentChanges[0];
      return `
        <article class="result-card">
          <div class="result-card-head">
            <div>
              <p class="card-label">${escapeHtml(issue.key)}</p>
              <h4>${escapeHtml(issue.summary)}</h4>
            </div>
            <span class="source-badge source-badge-jira">${escapeHtml(issue.status)}</span>
          </div>
          <p class="result-meta">
            Updated ${escapeHtml(formatDateTime(issue.updated))}
            ${issue.priority ? ` · Priority ${escapeHtml(issue.priority)}` : ""}
            ${issue.issueType ? ` · ${escapeHtml(issue.issueType)}` : ""}
          </p>
          ${
            latestChange
              ? `<ul class="mini-list">
                  <li>
                    Latest change: ${escapeHtml(latestChange.field)} -> ${escapeHtml(latestChange.to || "updated")} ·
                    ${escapeHtml(formatDateTime(latestChange.at))}
                  </li>
                </ul>`
              : '<p class="subtle-note">No field-level change details were returned for this issue.</p>'
          }
        </article>
      `;
    })
    .join("");
}

function renderGitHubResults(summary) {
  if (summary.needsClarification) {
    return stateCard(
      "Need a clearer teammate match",
      summary.clarificationReason || "Clarify the teammate name before the app can run a GitHub lookup.",
      "warning"
    );
  }

  if (!summary.github.status.ok) {
    return stateCard(
      "GitHub is unavailable",
      summary.github.status.message || "The GitHub lookup failed for this query.",
      "error"
    );
  }

  const commitMarkup = summary.github.data.commits
    .slice(0, 5)
    .map(
      (commit) => `
        <article class="result-card">
          <div class="result-card-head">
            <div>
              <p class="card-label">${escapeHtml(commit.repo)}</p>
              <h4>${escapeHtml(summarizeText(commit.message, 92))}</h4>
            </div>
            <span class="source-badge source-badge-github">${escapeHtml(commit.sha)}</span>
          </div>
          <p class="result-meta">Committed ${escapeHtml(formatDateTime(commit.authoredAt))}</p>
        </article>
      `
    )
    .join("");

  const pullRequestMarkup = summary.github.data.pullRequests
    .slice(0, 5)
    .map(
      (pullRequest) => `
        <article class="result-card">
          <div class="result-card-head">
            <div>
              <p class="card-label">${escapeHtml(`${pullRequest.repo} #${pullRequest.number}`)}</p>
              <h4>${escapeHtml(pullRequest.title)}</h4>
            </div>
            <span class="source-badge ${pullRequest.isOpen ? "source-badge-open" : "source-badge-closed"}">
              ${escapeHtml(pullRequest.state)}
            </span>
          </div>
          <p class="result-meta">Updated ${escapeHtml(formatDateTime(pullRequest.updatedAt))}</p>
        </article>
      `
    )
    .join("");

  const repoMarkup =
    summary.github.data.recentRepos.length > 0
      ? `
          <div class="repo-chip-row repo-chip-row-static">
            ${summary.github.data.recentRepos
              .map((repo) => `<span class="repo-chip">${escapeHtml(repo)}</span>`)
              .join("")}
          </div>
        `
      : "";

  if (!commitMarkup && !pullRequestMarkup) {
    return `
      ${repoMarkup}
      ${stateCard(
        "No recent GitHub activity",
        "No commits or pull request signals were found in the selected timeframe.",
        "muted"
      )}
    `;
  }

  return `
    ${repoMarkup}
    ${pullRequestMarkup ? `<div class="result-subgroup"><p class="card-label">Pull requests</p>${pullRequestMarkup}</div>` : ""}
    ${commitMarkup ? `<div class="result-subgroup"><p class="card-label">Commits</p>${commitMarkup}</div>` : ""}
  `;
}

function buildOverview(summary) {
  if (summary.needsClarification) {
    return summary.clarificationReason || "I could not confidently match the teammate in this request.";
  }

  const githubSignals =
    summary.github.data.commits.length + summary.github.data.pullRequests.length;

  if (
    summary.jira.status.ok &&
    summary.github.status.ok &&
    summary.jira.data.issues.length === 0 &&
    githubSignals === 0
  ) {
    return `${summary.member.displayName} has no recent Jira or GitHub activity in ${summary.timeframe.label}.`;
  }

  const sentences = [`${summary.member.displayName} during ${summary.timeframe.label}.`];

  if (summary.jira.status.ok) {
    sentences.push(
      `Jira shows ${summary.jira.data.issues.length} assigned issue(s) with ${summary.jira.data.recentUpdateCount} updated in-range.`
    );
  } else {
    sentences.push("Jira could not be included in this answer.");
  }

  if (summary.github.status.ok) {
    sentences.push(
      `GitHub shows ${summary.github.data.commits.length} commit(s) and ${summary.github.data.pullRequests.length} pull request signal(s).`
    );
  } else {
    sentences.push("GitHub could not be included in this answer.");
  }

  return sentences.join(" ");
}

function renderCaveats(summary, payload) {
  const caveats = [...summary.caveats];

  if (payload.staleData) {
    caveats.push("One or more connectors need attention, so this answer may rely on stale workspace configuration.");
  }

  if (caveats.length === 0) {
    caveats.push("Jira reflects assigned work; GitHub reflects recent code activity.");
    caveats.push("A missing signal does not necessarily mean no work happened.");
  }

  caveatsList.innerHTML = caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderQueryResponse(payload) {
  const { summary, connectorStatus, responseText: rawResponse } = payload;
  const githubSignals =
    summary.github.data.commits.length + summary.github.data.pullRequests.length;

  responseShell.classList.remove("is-empty", "is-loading");
  responseEmpty.classList.add("hidden");
  responseStructured.classList.remove("hidden");
  summaryTitle.textContent = summary.needsClarification
    ? "Need a clearer teammate match"
    : `Activity summary for ${summary.member.displayName}`;
  summaryOverview.textContent = buildOverview(summary);
  setMetricValue(summaryJiraIssues, summary.needsClarification ? "-" : String(summary.jira.data.issues.length));
  setMetricValue(summaryJiraUpdates, summary.needsClarification ? "-" : String(summary.jira.data.recentUpdateCount));
  setMetricValue(summaryGitHubSignals, summary.needsClarification ? "-" : String(githubSignals));
  setMetricValue(summaryRepos, summary.needsClarification ? "-" : String(summary.github.data.recentRepos.length));
  renderSourceStatuses(summary, connectorStatus, payload.staleData);
  jiraResults.innerHTML = renderJiraResults(summary);
  githubResults.innerHTML = renderGitHubResults(summary);
  renderCaveats(summary, payload);
  responseText.textContent = rawResponse;
  lastUpdated.textContent = `Last updated ${formatDateTime(new Date().toISOString())}`;
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
    renderEmptyResponse(
      "No active workspace",
      "Create or switch to an organization before running teammate activity queries."
    );
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
  jiraStatus.textContent = `Status: ${humanizeStatus(integrations.jira.status)}${integrations.jira.lastValidatedAt ? ` · validated ${formatDateTime(integrations.jira.lastValidatedAt)}` : ""}`;

  githubSecretRef.value = integrations.github.secretRef || "";
  githubEnabled.checked = integrations.github.enabled;
  githubStatus.textContent = `Status: ${humanizeStatus(integrations.github.status)}${integrations.github.lastValidatedAt ? ` · validated ${formatDateTime(integrations.github.lastValidatedAt)}` : ""}`;

  renderConnectorSnapshot(integrations.jira, workspaceJiraHealth, workspaceJiraMeta);
  renderConnectorSnapshot(integrations.github, workspaceGitHubHealth, workspaceGitHubMeta);

  const currentOrganization = organizations.find((organization) => organization.id === currentOrganizationId);
  orgName.textContent = currentOrganization?.name || "No organization";
  orgRole.textContent = currentOrganization ? `Role: ${currentOrganization.role}` : "Role unavailable";
  orgSlug.textContent = currentOrganization?.slug || "-";

  if (
    (integrations.jira.enabled && integrations.jira.status === "needs_attention") ||
    (integrations.github.enabled && integrations.github.status === "needs_attention")
  ) {
    setStatus("Review connectors", "warning");
  } else {
    setStatus("Ready", "ready");
  }
}

async function runQuery(event) {
  event.preventDefault();

  const query = queryInput.value.trim();
  if (!query) {
    setBanner("Enter a question before submitting.", "warning");
    return;
  }

  setStatus("Running", "loading");
  renderLoadingResponse(query);
  setBanner("");

  try {
    const payload = await api(`/api/v1/orgs/${currentOrganizationId}/query`, {
      method: "POST",
      body: JSON.stringify({ query })
    });

    renderQueryResponse(payload);

    if (payload.summary?.needsClarification) {
      setBanner(payload.summary.clarificationReason || "Clarification is required.", "warning");
      setStatus("Needs clarification", "warning");
    } else if (payload.partialData) {
      setBanner("Answer generated with partial provider data. Review source status below.", "warning");
      setStatus("Partial data", "warning");
    } else if (payload.summary?.caveats?.length) {
      setBanner(payload.summary.caveats[0], "warning");
      setStatus("Ready", "ready");
    } else {
      setBanner("Answer generated and saved to workspace history.", "success");
      setStatus("Ready", "ready");
    }

    await loadWorkspaceData();
  } catch (error) {
    responseText.textContent = "The query could not be completed.";
    renderEmptyResponse(
      "The query could not be completed",
      error instanceof Error ? error.message : "Unexpected error."
    );
    setStatus("Error", "error");
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
    renderEmptyResponse(
      "Workspace switched",
      "Run a teammate question in this workspace to generate a fresh grounded answer."
    );
    lastUpdated.textContent = "No query has been run in this workspace yet.";
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
  queryInput.focus();
});
document.querySelectorAll(".prompt-chip").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || "";
    queryInput.value = prompt;
    queryInput.focus();
  });
});
queryInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    queryForm.requestSubmit();
  }
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

renderEmptyResponse(
  "Start with a teammate question",
  "Try one of the example prompts to see Jira assignments, GitHub activity, and caveats in one grounded view."
);

Promise.resolve()
  .then(loadSession)
  .then(loadWorkspaceData)
  .catch((error) => {
    setBanner(error instanceof Error ? error.message : "Dashboard failed to load.", "error");
    renderEmptyResponse(
      "Dashboard failed to load",
      error instanceof Error ? error.message : "Unexpected error."
    );
    setStatus("Error", "error");
  });
