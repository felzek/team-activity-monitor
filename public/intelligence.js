/* intelligence.js — Team Activity Monitor Dashboard */
(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    session: null,
    csrfToken: null,
    orgId: null,
    activeTab: 'overview',
    activeGhSubtab: 'gh-commits',
    activeJiraSubtab: 'jira-open',
    github: null,
    jira: null,
    loadingGithub: true,
    loadingJira: true,
  };

  // ── Utilities ────────────────────────────────────────────────────────────

  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function relTime(isoStr) {
    if (!isoStr) return '—';
    const delta = Date.now() - new Date(isoStr).getTime();
    const secs = Math.floor(delta / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function shortDate(isoStr) {
    if (!isoStr) return '—';
    return new Date(isoStr).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  function shortSha(sha) {
    return sha ? sha.slice(0, 7) : '—';
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function statusCategoryBadge(cat, label) {
    const map = {
      todo: 'intel-badge-todo',
      inprogress: 'intel-badge-inprogress',
      done: 'intel-badge-done',
      unknown: 'intel-badge-unknown',
    };
    const cls = map[cat] || 'intel-badge-unknown';
    return `<span class="intel-badge ${cls}">${esc(label)}</span>`;
  }

  function priorityBadge(priority) {
    if (!priority) return '';
    const lower = priority.toLowerCase();
    let cls = 'intel-badge-priority-medium';
    if (lower === 'highest' || lower === 'critical') cls = 'intel-badge-priority-critical';
    else if (lower === 'high') cls = 'intel-badge-priority-high';
    else if (lower === 'low' || lower === 'lowest') cls = 'intel-badge-priority-low';
    return `<span class="intel-badge intel-badge-priority ${cls}">${esc(priority)}</span>`;
  }

  function externalLink(url, text) {
    if (!url) return esc(text);
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="intel-link">${esc(text)}</a>`;
  }

  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('intel-tab-pane-hidden', 'intel-subtab-pane-hidden', 'hidden');
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('intel-tab-pane-hidden', 'intel-subtab-pane-hidden', 'hidden');
  }

  // ── Skeleton HTML helpers ────────────────────────────────────────────────

  function skeletonKPIGrid(count) {
    return Array.from({ length: count }, () =>
      `<div class="intel-kpi-card intel-skeleton-card"><div class="intel-skeleton intel-skeleton-kpi"></div></div>`
    ).join('');
  }

  function skeletonTableRows(count) {
    return Array.from({ length: count }, () =>
      `<div class="intel-skeleton intel-skeleton-table-row"></div>`
    ).join('');
  }

  function skeletonFeedItems(count) {
    return Array.from({ length: count }, () =>
      `<div class="intel-skeleton intel-skeleton-feed-item"></div>`
    ).join('');
  }

  // ── KPI Card Builder ─────────────────────────────────────────────────────

  function kpiCard(value, label, sub, accentClass) {
    return `
      <article class="intel-kpi-card ${accentClass || ''}">
        <span class="intel-kpi-value">${esc(String(value))}</span>
        <span class="intel-kpi-label">${esc(label)}</span>
        ${sub ? `<span class="intel-kpi-sub muted-meta">${esc(sub)}</span>` : ''}
      </article>`;
  }

  // ── Empty & Error States ─────────────────────────────────────────────────

  function emptyState(title, description, action) {
    return `
      <div class="intel-empty-state">
        <div class="intel-empty-icon" aria-hidden="true">○</div>
        <h3 class="intel-empty-title">${esc(title)}</h3>
        <p class="intel-empty-desc">${esc(description)}</p>
        ${action ? `<p class="intel-empty-action">${action}</p>` : ''}
      </div>`;
  }

  function errorState(title, detail) {
    return `
      <div class="intel-error-state">
        <div class="intel-error-icon" aria-hidden="true">!</div>
        <h3 class="intel-error-title">${esc(title)}</h3>
        ${detail ? `<p class="intel-error-detail muted-meta">${esc(detail)}</p>` : ''}
      </div>`;
  }

  function disconnectedState(source) {
    const instructions = {
      github: 'Add GITHUB_TOKEN to your environment variables to connect GitHub.',
      jira: 'Add JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN to connect Jira.',
    };
    return `
      <div class="intel-disconnected-state">
        <div class="intel-disconnected-icon" aria-hidden="true">⊘</div>
        <h3 class="intel-disconnected-title">${esc(source)} is not connected</h3>
        <p class="intel-disconnected-desc muted-meta">${esc(instructions[source] || 'Configure credentials to enable this dashboard.')}</p>
        <a href="/app" class="button-secondary intel-btn-sm">Go to Workspace settings</a>
      </div>`;
  }

  // ── Data Table Builder ───────────────────────────────────────────────────

  function dataTable(headers, rows) {
    if (!rows.length) return '';
    const headHtml = headers
      .map((h) => `<th scope="col">${esc(h)}</th>`)
      .join('');
    const bodyHtml = rows
      .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
      .join('');
    return `
      <div class="intel-table-scroll" role="region" aria-label="Data table" tabindex="0">
        <table class="intel-table">
          <thead><tr>${headHtml}</tr></thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;
  }

  // ── Source Status Pills ──────────────────────────────────────────────────

  function updateSourcePill(id, connected, label) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `intel-source-pill ${connected ? 'intel-source-pill-ok' : 'intel-source-pill-off'}`;
    el.innerHTML = `<span class="intel-source-dot" aria-hidden="true"></span>${esc(label)}`;
    el.setAttribute('aria-label', `${label}: ${connected ? 'connected' : 'not connected'}`);
  }

  // ── Activity Feed ────────────────────────────────────────────────────────

  function buildActivityFeed(github, jira) {
    const items = [];

    if (github?.health.connected) {
      for (const commit of (github.recentCommits || []).slice(0, 10)) {
        items.push({
          source: 'github',
          type: 'commit',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>',
          title: truncate(commit.message, 80),
          sub: `${commit.repo} · ${commit.author || 'unknown'}`,
          ts: commit.authoredAt,
          url: commit.url,
          label: shortSha(commit.sha),
        });
      }
      for (const pr of (github.openPullRequests || []).slice(0, 5)) {
        items.push({
          source: 'github',
          type: 'pr',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
          title: truncate(pr.title, 80),
          sub: `${pr.repo} · ${pr.author || 'unknown'}`,
          ts: pr.updatedAt,
          url: pr.url,
          label: `#${pr.number}`,
        });
      }
    }

    if (jira?.health.connected) {
      for (const issue of (jira.recentlyUpdated || []).slice(0, 10)) {
        items.push({
          source: 'jira',
          type: 'issue',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z"/><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z"/><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z"/><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z"/><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z"/><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z"/><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z"/></svg>',
          title: truncate(issue.summary, 80),
          sub: `${issue.key} · ${issue.assignee || 'unassigned'} · ${issue.status}`,
          ts: issue.updated,
          url: issue.url,
          label: issue.key,
        });
      }
    }

    // Sort by timestamp descending
    items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

    if (!items.length) {
      return emptyState(
        'No recent activity',
        'Connect GitHub and Jira to see a live cross-source feed here.',
        ''
      );
    }

    const sourceColors = { github: 'intel-activity-github', jira: 'intel-activity-jira' };
    return items
      .slice(0, 20)
      .map(
        (item) => `
      <article class="intel-activity-item ${sourceColors[item.source] || ''}">
        <div class="intel-activity-icon" aria-hidden="true">${item.icon}</div>
        <div class="intel-activity-body">
          <p class="intel-activity-title">
            ${item.url ? externalLink(item.url, item.title) : esc(item.title)}
            <span class="intel-activity-label">${esc(item.label)}</span>
          </p>
          <p class="intel-activity-sub muted-meta">${esc(item.sub)}</p>
        </div>
        <time class="intel-activity-ts muted-meta" datetime="${esc(item.ts)}">${relTime(item.ts)}</time>
      </article>`
      )
      .join('');
  }

  // ── Source Health Cards (Overview) ───────────────────────────────────────

  function buildSourceHealthCard(sourceKey, data) {
    if (!data) {
      return `<div class="intel-source-status-card">
        <div class="intel-source-status-dot intel-dot-loading" aria-hidden="true"></div>
        <div>
          <p class="intel-source-status-name">${esc(sourceKey === 'github' ? 'GitHub' : 'Jira')}</p>
          <p class="muted-meta">Loading...</p>
        </div>
      </div>`;
    }

    const connected = data.health?.connected;
    const dotClass = connected ? 'intel-dot-ok' : 'intel-dot-off';
    const syncTime = data.fetchedAt ? `Last synced ${relTime(data.fetchedAt)}` : '';
    const meta = connected
      ? `${data.timeframeLabel || 'Last 7 days'} · ${syncTime}`
      : data.health?.errorMessage || 'Not connected';

    return `
      <div class="intel-source-status-card">
        <div class="intel-source-status-dot ${dotClass}" aria-hidden="true"></div>
        <div class="intel-source-status-body">
          <p class="intel-source-status-name">${esc(sourceKey === 'github' ? 'GitHub' : 'Jira')}</p>
          <p class="intel-source-status-meta muted-meta">${esc(meta)}</p>
          ${connected && data.health?.displayName && data.health.displayName !== 'GitHub' && data.health.displayName !== 'Fixture Mode'
            ? `<p class="intel-source-status-sub muted-meta">${esc(truncate(data.health.displayName, 50))}</p>`
            : ''}
        </div>
        ${connected
          ? `<span class="intel-badge intel-badge-connected">Connected</span>`
          : `<span class="intel-badge intel-badge-disconnected">Not connected</span>`}
      </div>`;
  }

  // ── GitHub Rendering ─────────────────────────────────────────────────────

  function renderGitHubKPIs(data) {
    if (!data) { setHTML('github-kpi-grid', skeletonKPIGrid(4)); return; }
    if (!data.health?.connected) {
      setHTML('github-kpi-grid', `<div class="intel-kpi-disconnected">${disconnectedState('GitHub')}</div>`);
      return;
    }
    const m = data.metrics;
    setHTML('github-kpi-grid', [
      kpiCard(m.totalCommits, 'Commits', data.timeframeLabel, 'intel-kpi-primary'),
      kpiCard(m.openPRs, 'Open pull requests', '', 'intel-kpi-accent'),
      kpiCard(m.activeRepos, 'Active repos', `of ${m.trackedRepos} tracked`, ''),
      kpiCard(m.trackedRepos, 'Tracked repos', '', ''),
    ].join(''));
  }

  function renderGitHubHeader(data) {
    if (!data) return;
    const connected = data.health?.connected;
    const meta = connected
      ? `${data.timeframeLabel} · Last synced ${relTime(data.fetchedAt)} · ${data.metrics.trackedRepos} repos tracked`
      : (data.health?.errorMessage || 'Not connected');
    setText('github-header-title', 'GitHub');
    setText('github-header-meta', meta);
  }

  function renderGitHubCommits(data) {
    if (!data?.health?.connected) {
      setHTML('gh-commits-content', disconnectedState('GitHub'));
      return;
    }
    const commits = data.recentCommits || [];
    if (!commits.length) {
      setHTML('gh-commits-content', emptyState('No commits', 'No commits found in tracked repos for the selected timeframe.', ''));
      return;
    }
    const rows = commits.map((c) => [
      `<code class="intel-sha">${externalLink(c.url, shortSha(c.sha))}</code>`,
      `<span class="intel-repo-name">${esc(c.repo)}</span>`,
      `<span class="intel-commit-msg" title="${esc(c.message)}">${truncate(c.message, 72)}</span>`,
      esc(c.author || '—'),
      `<time datetime="${esc(c.authoredAt)}" title="${esc(shortDate(c.authoredAt))}">${relTime(c.authoredAt)}</time>`,
    ]);
    setHTML('gh-commits-content', dataTable(['SHA', 'Repository', 'Message', 'Author', 'When'], rows));
  }

  function renderGitHubPRs(data) {
    if (!data?.health?.connected) {
      setHTML('gh-prs-content', disconnectedState('GitHub'));
      return;
    }
    const prs = data.openPullRequests || [];
    if (!prs.length) {
      setHTML('gh-prs-content', emptyState('No open pull requests', 'All clear — no open PRs found in tracked repos.', ''));
      return;
    }
    const rows = prs.map((pr) => [
      `<span class="intel-pr-num">${externalLink(pr.url, '#' + pr.number)}</span>`,
      `<span class="intel-repo-name">${esc(pr.repo)}</span>`,
      `<span class="intel-pr-title" title="${esc(pr.title)}">${truncate(pr.title, 70)}</span>`,
      `<span class="intel-badge intel-badge-open">Open</span>`,
      esc(pr.author || '—'),
      `<time datetime="${esc(pr.updatedAt)}" title="${esc(shortDate(pr.updatedAt))}">${relTime(pr.updatedAt)}</time>`,
    ]);
    setHTML('gh-prs-content', dataTable(['#', 'Repository', 'Title', 'State', 'Author', 'Updated'], rows));
  }

  function renderGitHubRepos(data) {
    if (!data?.health?.connected) {
      setHTML('gh-repos-content', disconnectedState('GitHub'));
      return;
    }
    const repos = data.repoStats || [];
    if (!repos.length) {
      setHTML('gh-repos-content', emptyState('No repositories', 'No tracked repos configured for this workspace.', ''));
      return;
    }
    const sorted = [...repos].sort((a, b) => b.commitCount - a.commitCount);
    const rows = sorted.map((r) => [
      `<span class="intel-repo-name">${esc(r.fullName)}</span>`,
      `<strong>${r.commitCount}</strong>`,
      `<strong>${r.openPRCount}</strong>`,
      r.lastActivityAt
        ? `<time datetime="${esc(r.lastActivityAt)}">${relTime(r.lastActivityAt)}</time>`
        : '<span class="muted-meta">No recent activity</span>',
    ]);
    setHTML('gh-repos-content', dataTable(['Repository', 'Commits (7d)', 'Open PRs', 'Last activity'], rows));
  }

  function renderGitHubCaveats(data) {
    if (!data?.caveats?.length) return;
    const el = document.getElementById('github-source-header');
    if (!el || document.getElementById('github-caveats')) return;
    const div = document.createElement('div');
    div.id = 'github-caveats';
    div.className = 'intel-caveats';
    div.innerHTML = data.caveats.map((c) => `<p class="intel-caveat">⚠ ${esc(c)}</p>`).join('');
    el.parentNode.insertBefore(div, el.nextSibling);
  }

  // ── Jira Rendering ───────────────────────────────────────────────────────

  function renderJiraKPIs(data) {
    if (!data) { setHTML('jira-kpi-grid', skeletonKPIGrid(4)); return; }
    if (!data.health?.connected) {
      setHTML('jira-kpi-grid', `<div class="intel-kpi-disconnected">${disconnectedState('Jira')}</div>`);
      return;
    }
    const m = data.metrics;
    setHTML('jira-kpi-grid', [
      kpiCard(m.openIssues, 'Open issues', '', 'intel-kpi-primary'),
      kpiCard(m.inProgress, 'In progress', '', 'intel-kpi-accent'),
      kpiCard(m.recentlyUpdated, 'Updated this week', '', ''),
      kpiCard(m.projects, 'Active projects', '', ''),
    ].join(''));
  }

  function renderJiraHeader(data) {
    if (!data) return;
    const connected = data.health?.connected;
    const meta = connected
      ? `${data.timeframeLabel} · Last synced ${relTime(data.fetchedAt)} · ${data.metrics.projects} project(s)`
      : (data.health?.errorMessage || 'Not connected');
    setText('jira-header-title', 'Jira');
    setText('jira-header-meta', meta);
  }

  function renderJiraIssueTable(issues, containerId) {
    if (!issues.length) {
      setHTML(containerId, emptyState('No issues', 'No issues found for the current filter.', ''));
      return;
    }
    const rows = issues.map((issue) => [
      `<span class="intel-issue-key">${externalLink(issue.url, issue.key)}</span>`,
      `<span class="intel-issue-summary" title="${esc(issue.summary)}">${truncate(issue.summary, 72)}</span>`,
      statusCategoryBadge(issue.statusCategory, issue.status),
      issue.issueType ? `<span class="muted-meta">${esc(issue.issueType)}</span>` : '<span class="muted-meta">—</span>',
      priorityBadge(issue.priority),
      esc(issue.assignee || 'Unassigned'),
      `<time datetime="${esc(issue.updated)}" title="${esc(shortDate(issue.updated))}">${relTime(issue.updated)}</time>`,
    ]);
    setHTML(containerId, dataTable(['Key', 'Summary', 'Status', 'Type', 'Priority', 'Assignee', 'Updated'], rows));
  }

  function renderJiraProjects(data) {
    const projects = data?.projects || [];
    if (!projects.length) {
      setHTML('jira-projects-content', emptyState('No projects', 'No Jira projects found with open issues.', ''));
      return;
    }
    const sorted = [...projects].sort((a, b) => b.openIssueCount - a.openIssueCount);
    const rows = sorted.map((p) => [
      `<strong class="intel-project-key">${esc(p.key)}</strong>`,
      esc(p.name),
      `<strong>${p.openIssueCount}</strong>`,
    ]);
    setHTML('jira-projects-content', dataTable(['Key', 'Project', 'Open issues'], rows));
  }

  // ── Overview Tab Rendering ───────────────────────────────────────────────

  function renderOverviewKPIs() {
    const gh = state.github;
    const jira = state.jira;
    const cards = [];

    if (gh?.health?.connected) {
      cards.push(kpiCard(gh.metrics.totalCommits, 'Commits', 'Last 7 days · GitHub', 'intel-kpi-primary'));
      cards.push(kpiCard(gh.metrics.openPRs, 'Open PRs', 'GitHub', 'intel-kpi-accent'));
      cards.push(kpiCard(gh.metrics.activeRepos, 'Active repos', `of ${gh.metrics.trackedRepos} · GitHub`, ''));
    } else if (gh) {
      cards.push(kpiCard('—', 'Commits', 'GitHub not connected', 'intel-kpi-muted'));
      cards.push(kpiCard('—', 'Open PRs', 'GitHub not connected', 'intel-kpi-muted'));
    }

    if (jira?.health?.connected) {
      cards.push(kpiCard(jira.metrics.openIssues, 'Open issues', 'Jira', 'intel-kpi-primary'));
      cards.push(kpiCard(jira.metrics.inProgress, 'In progress', 'Jira', 'intel-kpi-accent'));
      cards.push(kpiCard(jira.metrics.recentlyUpdated, 'Updated this week', 'Jira', ''));
    } else if (jira) {
      cards.push(kpiCard('—', 'Open issues', 'Jira not connected', 'intel-kpi-muted'));
      cards.push(kpiCard('—', 'In progress', 'Jira not connected', 'intel-kpi-muted'));
    }

    if (!cards.length) {
      setHTML('overview-kpi-grid', skeletonKPIGrid(6));
      return;
    }
    setHTML('overview-kpi-grid', cards.join(''));
  }

  function renderSourcePairGrid() {
    setHTML('source-pair-grid', [
      buildSourceHealthCard('github', state.github),
      buildSourceHealthCard('jira', state.jira),
    ].join(''));
  }

  function renderActivityFeed() {
    setHTML('activity-feed', buildActivityFeed(state.github, state.jira));
    const gh = state.github;
    const jira = state.jira;
    const parts = [];
    if (gh?.health?.connected) parts.push(`${gh.metrics.totalCommits} commits`);
    if (jira?.health?.connected) parts.push(`${jira.metrics.recentlyUpdated} Jira updates`);
    setText('activity-feed-meta', parts.length ? parts.join(' · ') + ' · Last 7 days' : 'No data available');
  }

  // ── AI Insight ───────────────────────────────────────────────────────────

  async function loadAiInsight() {
    if (!state.orgId) return;
    setText('ai-text', 'Generating insight...');
    try {
      const resp = await fetch(`/api/v1/orgs/${state.orgId}/dashboard/insight`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': state.csrfToken || '',
        },
        body: JSON.stringify({ github: state.github, jira: state.jira }),
      });
      if (!resp.ok) throw new Error();
      const data = await resp.json();
      const banner = document.getElementById('ai-banner');
      if (data.text) {
        setText('ai-text', data.text);
        if (banner) banner.classList.remove('intel-ai-banner-muted');
      } else {
        setText('ai-text', 'AI insight unavailable — start Ollama to enable this feature.');
        if (banner) banner.classList.add('intel-ai-banner-muted');
      }
    } catch {
      setText('ai-text', 'AI insight unavailable right now.');
      const banner = document.getElementById('ai-banner');
      if (banner) banner.classList.add('intel-ai-banner-muted');
    }
  }

  // ── Data Loading ─────────────────────────────────────────────────────────

  async function loadGitHub() {
    state.loadingGithub = true;
    renderGitHubKPIs(null);
    setHTML('gh-commits-content', skeletonTableRows(5));
    try {
      const resp = await fetch(`/api/v1/orgs/${state.orgId}/dashboard/github`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      state.github = await resp.json();
    } catch (e) {
      state.github = {
        health: { connected: false, mode: 'unavailable', displayName: null, errorMessage: e.message },
        metrics: { totalCommits: 0, openPRs: 0, activeRepos: 0, trackedRepos: 0 },
        repoStats: [], recentCommits: [], openPullRequests: [],
        fetchedAt: new Date().toISOString(), caveats: [e.message],
      };
    }
    state.loadingGithub = false;
    renderGitHubHeader(state.github);
    renderGitHubKPIs(state.github);
    renderGitHubCommits(state.github);
    renderGitHubPRs(state.github);
    renderGitHubRepos(state.github);
    renderGitHubCaveats(state.github);
    updateSourcePill('gh-status-pill', state.github?.health?.connected, 'GitHub');
  }

  async function loadJira() {
    state.loadingJira = true;
    renderJiraKPIs(null);
    setHTML('jira-open-content', skeletonTableRows(5));
    try {
      const resp = await fetch(`/api/v1/orgs/${state.orgId}/dashboard/jira`);
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      state.jira = await resp.json();
    } catch (e) {
      state.jira = {
        health: { connected: false, mode: 'unavailable', displayName: null, errorMessage: e.message },
        metrics: { openIssues: 0, inProgress: 0, recentlyUpdated: 0, projects: 0 },
        openIssues: [], recentlyUpdated: [], projects: [],
        fetchedAt: new Date().toISOString(), caveats: [e.message],
      };
    }
    state.loadingJira = false;
    renderJiraHeader(state.jira);
    renderJiraKPIs(state.jira);
    if (state.jira?.health?.connected) {
      renderJiraIssueTable(state.jira.openIssues || [], 'jira-open-content');
      renderJiraIssueTable(state.jira.recentlyUpdated || [], 'jira-recent-content');
      renderJiraProjects(state.jira);
    } else {
      setHTML('jira-open-content', disconnectedState('Jira'));
      setHTML('jira-recent-content', '');
      setHTML('jira-projects-content', '');
    }
    updateSourcePill('jira-status-pill', state.jira?.health?.connected, 'Jira');
  }

  function updateOverviewTab() {
    renderOverviewKPIs();
    renderActivityFeed();
    renderSourcePairGrid();
  }

  // ── Tab Navigation ───────────────────────────────────────────────────────

  function initTabNavigation() {
    document.querySelectorAll('.intel-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (!tabId) return;
        switchTab(tabId);
      });
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });
  }

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.intel-tab').forEach((btn) => {
      const active = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('intel-tab-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    ['overview', 'github', 'jira'].forEach((id) => {
      const pane = document.getElementById(`tab-${id}`);
      if (pane) {
        if (id === tabId) {
          pane.classList.remove('intel-tab-pane-hidden');
        } else {
          pane.classList.add('intel-tab-pane-hidden');
        }
      }
    });
  }

  function initSubTabNavigation(barId, contentId, onSwitch) {
    const bar = document.getElementById(barId);
    if (!bar) return;
    bar.querySelectorAll('.intel-subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const subtabId = btn.getAttribute('data-subtab');
        if (!subtabId) return;

        // Update buttons
        bar.querySelectorAll('.intel-subtab').forEach((b) => {
          const active = b.getAttribute('data-subtab') === subtabId;
          b.classList.toggle('intel-subtab-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        // Update panes
        const content = document.getElementById(contentId);
        if (content) {
          content.querySelectorAll('.intel-subtab-pane').forEach((pane) => {
            if (pane.id === subtabId) {
              pane.classList.remove('intel-subtab-pane-hidden');
            } else {
              pane.classList.add('intel-subtab-pane-hidden');
            }
          });
        }

        if (onSwitch) onSwitch(subtabId);
      });
    });
  }

  // ── Top Nav ──────────────────────────────────────────────────────────────

  function updateTopNav(session) {
    setText('topnav-user', session.user?.name || session.user?.email || 'User');
    setText('topnav-org', session.currentOrganization?.name || '');

    const logoutBtn = document.getElementById('topnav-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/v1/auth/logout', {
            method: 'POST',
            headers: { 'x-csrf-token': state.csrfToken || '' },
          });
        } finally {
          window.location.href = '/login';
        }
      });
    }
  }

  // ── Refresh Handlers ─────────────────────────────────────────────────────

  function initRefreshHandlers() {
    const ghRefresh = document.getElementById('github-refresh-btn');
    if (ghRefresh) {
      ghRefresh.addEventListener('click', () => {
        ghRefresh.disabled = true;
        ghRefresh.textContent = 'Refreshing...';
        loadGitHub().then(() => {
          if (!state.loadingGithub && !state.loadingJira) updateOverviewTab();
          ghRefresh.disabled = false;
          ghRefresh.textContent = 'Refresh';
        });
      });
    }

    const jiraRefresh = document.getElementById('jira-refresh-btn');
    if (jiraRefresh) {
      jiraRefresh.addEventListener('click', () => {
        jiraRefresh.disabled = true;
        jiraRefresh.textContent = 'Refreshing...';
        loadJira().then(() => {
          if (!state.loadingGithub && !state.loadingJira) updateOverviewTab();
          jiraRefresh.disabled = false;
          jiraRefresh.textContent = 'Refresh';
        });
      });
    }

    const aiRefresh = document.getElementById('ai-refresh-btn');
    if (aiRefresh) {
      aiRefresh.addEventListener('click', () => {
        loadAiInsight();
      });
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async function init() {
    let session;
    try {
      const resp = await fetch('/api/v1/auth/session');
      session = await resp.json();
    } catch {
      window.location.href = '/login';
      return;
    }

    if (!session.authenticated) {
      window.location.href = '/login';
      return;
    }

    state.session = session;
    state.csrfToken = session.csrfToken;
    state.orgId = session.currentOrganization?.id || null;

    // Restore filter context if navigated here from the dashboard with a
    // person/timeRange param (e.g., after clicking "Full board ↗")
    if (typeof IntelState !== 'undefined') {
      IntelState.fromUrl();
      const filter = IntelState.getFilter();
      if (filter.person) {
        // Show a dismissable context banner so the user knows the board is
        // contextualised and can easily return to the full team view.
        const titleArea = document.querySelector('.intel-page-title-area');
        if (titleArea && !document.getElementById('intel-ctx-banner')) {
          const banner = document.createElement('div');
          banner.id = 'intel-ctx-banner';
          banner.className = 'intel-ctx-banner';
          banner.innerHTML =
            'Contextualised for <strong>' + esc(filter.person) + '</strong>'
            + ' &mdash; <button id="intel-ctx-clear" class="intel-ctx-clear-btn" type="button">View all team</button>';
          titleArea.appendChild(banner);
          document.getElementById('intel-ctx-clear')?.addEventListener('click', () => {
            if (typeof IntelState !== 'undefined') IntelState.reset();
            window.history.replaceState({}, document.title, '/intelligence');
            banner.remove();
          });
        }
        // Update subtitle
        const sub = document.querySelector('.intel-subtitle');
        if (sub) sub.textContent = 'Filtered to ' + filter.person + ' \u2014 last 7 days';
      }
    }

    updateTopNav(session);
    initTabNavigation();
    initSubTabNavigation('github-subtab-bar', 'gh-subtab-content', (id) => { state.activeGhSubtab = id; });
    initSubTabNavigation('jira-subtab-bar', 'jira-subtab-content', (id) => { state.activeJiraSubtab = id; });
    initRefreshHandlers();

    if (!state.orgId) {
      setHTML('tab-overview', `<div class="intel-global-error">
        <p class="intel-global-error-title">No active workspace</p>
        <p class="muted-meta">Return to the <a href="/app" class="intel-link">Workspace</a> to set up an organization first.</p>
      </div>`);
      return;
    }

    // Load both data sources in parallel
    const [, ] = await Promise.all([loadGitHub(), loadJira()]);

    // After both complete, update overview and fetch AI insight
    updateOverviewTab();
    loadAiInsight();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
