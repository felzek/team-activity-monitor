const queryForm = document.getElementById("demo-query-form");
const queryInput = document.getElementById("demo-query");
const submitButton = document.getElementById("demo-submit");
const statusText = document.getElementById("demo-status");
const emptyState = document.getElementById("demo-empty");
const responsePanel = document.getElementById("demo-response");
const memberTitle = document.getElementById("demo-member-title");
const rawAnswer = document.getElementById("demo-raw-answer");
const structured = document.getElementById("demo-structured");
const jiraCount = document.getElementById("demo-jira-count");
const githubCount = document.getElementById("demo-github-count");
const repoCount = document.getElementById("demo-repo-count");
const timeframeEl = document.getElementById("demo-timeframe");
const jiraList = document.getElementById("demo-jira-list");
const githubList = document.getElementById("demo-github-list");
const caveatsSection = document.getElementById("demo-caveats");
const caveatList = document.getElementById("demo-caveat-list");
const promptButtons = document.querySelectorAll(".demo-prompt");

let csrfToken = null;
let demoOrgId = null;

async function initDemo() {
  try {
    const response = await fetch("/api/v1/demo/session");
    const payload = await response.json();

    if (!response.ok) {
      statusText.textContent = payload.error || "Could not initialize demo.";
      return;
    }

    csrfToken = payload.csrfToken;
    demoOrgId = payload.organizationId;
  } catch (error) {
    statusText.textContent = "Demo could not connect to the server.";
  }
}

function renderJiraIssues(jira) {
  if (!jira || !jira.issues || jira.issues.length === 0) {
    jiraList.innerHTML = '<p class="muted-meta">No assigned Jira issues found.</p>';
    return;
  }

  jiraList.innerHTML = jira.issues
    .map(
      (issue) => `
      <div class="demo-item">
        <div class="demo-item-head">
          <strong>${issue.key}</strong>
          <span class="demo-item-tag demo-tag-jira">${issue.status}</span>
        </div>
        <p>${issue.summary}</p>
        ${issue.priority ? `<span class="muted-meta">${issue.priority}</span>` : ""}
      </div>`
    )
    .join("");
}

function renderGitHubActivity(github) {
  if (!github) {
    githubList.innerHTML = '<p class="muted-meta">No GitHub activity found.</p>';
    return;
  }

  const items = [];

  if (github.pullRequests && github.pullRequests.length > 0) {
    github.pullRequests.forEach((pr) => {
      items.push(`
        <div class="demo-item">
          <div class="demo-item-head">
            <strong>${pr.repo}#${pr.number}</strong>
            <span class="demo-item-tag ${pr.isOpen ? "demo-tag-open" : "demo-tag-closed"}">${pr.state}</span>
          </div>
          <p>${pr.title}</p>
        </div>`);
    });
  }

  if (github.commits && github.commits.length > 0) {
    github.commits.slice(0, 8).forEach((commit) => {
      items.push(`
        <div class="demo-item">
          <div class="demo-item-head">
            <strong>${commit.repo}</strong>
            <code class="demo-sha">${commit.sha}</code>
          </div>
          <p>${commit.message}</p>
        </div>`);
    });
  }

  if (items.length === 0) {
    githubList.innerHTML = '<p class="muted-meta">No GitHub activity found.</p>';
    return;
  }

  githubList.innerHTML = items.join("");
}

function renderCaveats(caveats) {
  if (!caveats || caveats.length === 0) {
    caveatsSection.classList.add("hidden");
    return;
  }

  caveatsSection.classList.remove("hidden");
  caveatList.innerHTML = caveats.map((c) => `<li>${c}</li>`).join("");
}

async function runQuery(query) {
  if (!demoOrgId) {
    statusText.textContent = "Demo not ready. Refresh and try again.";
    return;
  }

  submitButton.disabled = true;
  statusText.textContent = "Running query...";
  emptyState.classList.add("hidden");
  responsePanel.classList.add("hidden");

  try {
    const response = await fetch(`/api/v1/demo/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrfToken || ""
      },
      body: JSON.stringify({ query })
    });

    const payload = await response.json();

    if (!response.ok) {
      statusText.textContent = payload.error || "Query failed.";
      emptyState.classList.remove("hidden");
      return;
    }

    const summary = payload.summary;
    const member = summary?.member;

    memberTitle.textContent = member
      ? `${member.displayName} — activity summary`
      : "Activity summary";

    rawAnswer.textContent = payload.responseText || "No response generated.";

    if (summary) {
      structured.classList.remove("hidden");

      const jiraIssues = summary.jira?.issues?.length || 0;
      const commits = summary.github?.commits?.length || 0;
      const prs = summary.github?.pullRequests?.length || 0;
      const repos = summary.github?.recentRepos?.length || 0;

      jiraCount.textContent = String(jiraIssues);
      githubCount.textContent = String(commits + prs);
      repoCount.textContent = String(repos);
      timeframeEl.textContent = summary.timeframe?.description || "14 days";

      renderJiraIssues(summary.jira);
      renderGitHubActivity(summary.github);
      renderCaveats(summary.caveats);
    } else {
      structured.classList.add("hidden");
    }

    responsePanel.classList.remove("hidden");
    statusText.textContent = "";
  } catch (error) {
    statusText.textContent =
      error instanceof Error ? error.message : "Something went wrong.";
    emptyState.classList.remove("hidden");
  } finally {
    submitButton.disabled = false;
  }
}

queryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  if (query) {
    runQuery(query);
  }
});

promptButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    queryInput.value = prompt;
    runQuery(prompt);
  });
});

initDemo();
