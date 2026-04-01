/**
 * IntelOverview — compact intelligence panel for the workspace dashboard.
 *
 * Renders into #intel-overview-body inside the pre-existing
 * #intel-overview-section panel in dashboard.html.
 *
 * Data contract: GET /api/v1/orgs/:orgId/intelligence/overview
 * Shared state:  window.IntelState (intel-state.js, loaded first)
 *
 * Public API:
 *   IntelOverview.init(orgId)   — call after session resolves
 *   IntelOverview.refresh()     — re-fetch and re-render
 *
 * Chat integration:
 *   Listens to IntelState event 'queryComplete' → refresh
 *   Emits  IntelState event 'seedQuery' (text) → dashboard.js seeds textarea
 *
 * Navigation:
 *   "Full board ↗" CTA href is kept in sync with IntelState.boardUrl()
 *   Clicking an item opens the detail drawer
 *   Drawer "Ask about this" button emits seedQuery then closes
 *   Drawer "View full board ↗" navigates to board with current filter state
 */
(function () {
  'use strict';

  // ── Private state ──────────────────────────────────────────────────────────
  var _orgId   = null;
  var _data    = null;
  var _loading = false;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,  '&amp;')
      .replace(/</g,  '&lt;')
      .replace(/>/g,  '&gt;')
      .replace(/"/g,  '&quot;')
      .replace(/'/g,  '&#39;');
  }

  function relTime(iso) {
    if (!iso) return '—';
    var secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60)    return 'just now';
    if (secs < 3600)  return Math.floor(secs / 60)   + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600)  + 'h ago';
    return Math.floor(secs / 86400) + 'd ago';
  }

  function truncate(s, n) {
    s = s || '';
    return s.length > n ? s.slice(0, n - 1) + '\u2026' : s;
  }

  var ICONS = {
    commit: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/></svg>',
    pr:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>',
    issue:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    warn:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  // ── KPI card ───────────────────────────────────────────────────────────────

  function kpiCard(value, label, sub, muted) {
    return '<article class="intel-kpi-card intel-ov-kpi' + (muted ? ' intel-kpi-muted' : '') + '">'
      + '<span class="intel-kpi-value">' + esc(String(value)) + '</span>'
      + '<span class="intel-kpi-label">' + esc(label) + '</span>'
      + (sub ? '<span class="intel-kpi-sub muted-meta">' + esc(sub) + '</span>' : '')
      + '</article>';
  }

  // ── Activity item (clickable) ──────────────────────────────────────────────

  function activityItemHtml(item) {
    var srcCls = item.source === 'github' ? 'intel-activity-github' : 'intel-activity-jira';
    var icon   = ICONS[item.type] || ICONS.issue;
    return '<article class="intel-activity-item ' + srcCls + ' intel-ov-clickable"'
      + ' data-item-id="' + esc(item.id) + '"'
      + ' role="button" tabindex="0"'
      + ' aria-label="' + esc('Open detail: ' + truncate(item.title, 50)) + '">'
      + '<div class="intel-activity-icon" aria-hidden="true">' + icon + '</div>'
      + '<div class="intel-activity-body">'
      + '<p class="intel-activity-title">' + esc(truncate(item.title, 70)) + '</p>'
      + '<p class="intel-activity-sub muted-meta">' + esc(item.subtitle) + ' \xb7 ' + esc(item.author) + '</p>'
      + '</div>'
      + '<time class="intel-activity-ts muted-meta" datetime="' + esc(item.timestamp) + '">' + relTime(item.timestamp) + '</time>'
      + '</article>';
  }

  // ── Blocker item (clickable) ───────────────────────────────────────────────

  function blockerItemHtml(item) {
    var typeLabel = item.type === 'stale_pr' ? 'Stale PR' : 'Overdue';
    return '<article class="intel-ov-blocker intel-ov-clickable"'
      + ' data-item-id="' + esc(item.id) + '"'
      + ' role="button" tabindex="0"'
      + ' aria-label="' + esc('Open detail: ' + truncate(item.title, 50)) + '">'
      + '<div class="intel-ov-blocker-hd">'
      + '<span class="intel-ov-blocker-badge">' + esc(typeLabel) + '</span>'
      + '<span class="intel-ov-blocker-age muted-meta">' + esc(item.ageLabel) + '</span>'
      + '</div>'
      + '<p class="intel-ov-blocker-title">' + esc(truncate(item.title, 72)) + '</p>'
      + '</article>';
  }

  // ── Source health pill ─────────────────────────────────────────────────────

  function healthPill(source, health) {
    var label = source === 'github' ? 'GitHub' : 'Jira';
    var cls   = !health.connected             ? 'intel-source-pill-off'
              : health.staleness === 'stale'  ? 'intel-source-pill-warn'
              :                                 'intel-source-pill-ok';
    var syncText = health.lastSyncedAt ? ' \xb7 ' + relTime(health.lastSyncedAt) : '';
    return '<span class="intel-source-pill ' + cls + '" title="'
      + esc(health.error || (label + (health.connected ? ' connected' : ' not connected'))) + '">'
      + '<span class="intel-source-dot" aria-hidden="true"></span>'
      + esc(label) + esc(syncText)
      + '</span>';
  }

  // ── Skeleton ───────────────────────────────────────────────────────────────

  function skeletonHtml() {
    var kpis = '<div class="intel-ov-kpi-row">'
      + Array(4).fill('<div class="intel-kpi-card intel-skeleton-card"><div class="intel-skeleton intel-skeleton-kpi"></div></div>').join('')
      + '</div>';
    var feed = Array(3).fill('<div class="intel-skeleton intel-skeleton-feed-item"></div>').join('');
    var blkr = Array(2).fill('<div class="intel-skeleton intel-ov-skeleton-block"></div>').join('');
    return kpis
      + '<div class="intel-ov-grid">'
      + '<div class="intel-ov-col"><p class="intel-ov-col-label eyebrow">Recent activity</p><div class="intel-activity-feed">' + feed + '</div></div>'
      + '<div class="intel-ov-col"><p class="intel-ov-col-label eyebrow">Needs attention</p>' + blkr + '</div>'
      + '</div>';
  }

  // ── Main render ────────────────────────────────────────────────────────────

  function render(data) {
    var body = document.getElementById('intel-overview-body');
    if (!body) return;

    var gh   = data.sourceHealth.github;
    var jira = data.sourceHealth.jira;
    var s    = data.summary;

    var kpis = [
      kpiCard(gh.connected   ? s.commits    : '\u2014', 'Commits (7d)',   'GitHub', !gh.connected),
      kpiCard(gh.connected   ? s.openPRs    : '\u2014', 'Open PRs',       'GitHub', !gh.connected),
      kpiCard(jira.connected ? s.openIssues : '\u2014', 'Open issues',    'Jira',   !jira.connected),
      kpiCard(jira.connected ? s.inProgress : '\u2014', 'In progress',    'Jira',   !jira.connected),
    ];

    var actHtml = data.recentActivity.length
      ? data.recentActivity.map(activityItemHtml).join('')
      : '<p class="intel-ov-empty muted-meta">No recent activity. Connect GitHub and Jira to see live data here.</p>';

    var blkHtml = data.blockers.length
      ? data.blockers.map(blockerItemHtml).join('')
      : '<p class="intel-ov-empty muted-meta">No blockers detected.</p>';

    body.innerHTML =
        '<div class="intel-ov-kpi-row">' + kpis.join('') + '</div>'
      + '<div class="intel-ov-grid">'
      +   '<div class="intel-ov-col">'
      +     '<p class="intel-ov-col-label eyebrow">Recent activity</p>'
      +     '<div class="intel-activity-feed intel-ov-feed" role="feed">' + actHtml + '</div>'
      +   '</div>'
      +   '<div class="intel-ov-col">'
      +     '<p class="intel-ov-col-label eyebrow">Needs attention</p>'
      +     '<div class="intel-ov-blockers">' + blkHtml + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="intel-ov-health-bar">'
      +   healthPill('github', gh)
      +   healthPill('jira', jira)
      +   '<span class="intel-ov-health-ts muted-meta">Updated ' + relTime(data.fetchedAt) + '</span>'
      + '</div>';

    // Wire clickable items
    body.querySelectorAll('.intel-ov-clickable').forEach(function (el) {
      el.addEventListener('click', function () { openDrawer(el.dataset.itemId); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
    });
  }

  function renderError(msg) {
    var body = document.getElementById('intel-overview-body');
    if (body) body.innerHTML = '<div class="intel-error-state"><p class="intel-error-detail muted-meta">Intelligence overview unavailable: ' + esc(msg) + '</p></div>';
  }

  // ── Detail drawer ──────────────────────────────────────────────────────────

  function allItems(data) {
    return (data.recentActivity || []).concat(data.blockers || []);
  }

  function drawerPrompt(item) {
    if (!item) return '';
    if (item.type === 'commit')        return 'Tell me more about recent commits in ' + item.subtitle;
    if (item.type === 'pr')            return 'What is the status of pull request: ' + item.title;
    if (item.type === 'stale_pr')      return 'Why is this PR stale and what should happen next? ' + item.title;
    if (item.type === 'overdue_issue') return 'This issue seems overdue. What is the latest on ' + item.subtitle + '?';
    return 'Tell me more about: ' + item.title;
  }

  function openDrawer(itemId) {
    if (!_data) return;
    var item = allItems(_data).find(function (i) { return i.id === itemId; });
    if (!item) return;

    var drawer = document.getElementById('intel-drawer');
    if (!drawer) return;

    var typeLabel = {
      commit: 'Commit', pr: 'Pull Request',
      issue: 'Issue', stale_pr: 'Stale PR', overdue_issue: 'Overdue Issue',
    }[item.type] || 'Item';

    var titleEl = document.getElementById('intel-drawer-title');
    if (titleEl) titleEl.textContent = truncate(item.title, 64);

    var bodyEl = document.getElementById('intel-drawer-body');
    if (bodyEl) {
      bodyEl.innerHTML =
          '<dl class="intel-drawer-meta">'
        + '<dt>Type</dt><dd>' + esc(typeLabel) + '</dd>'
        + '<dt>Source</dt><dd>' + esc(item.source === 'github' ? 'GitHub' : 'Jira') + '</dd>'
        + (item.author   ? '<dt>By</dt><dd>'      + esc(item.author)   + '</dd>' : '')
        + (item.subtitle ? '<dt>Context</dt><dd>' + esc(item.subtitle) + '</dd>' : '')
        + (item.ageLabel ? '<dt>Age</dt><dd>'     + esc(item.ageLabel) + '</dd>' : '')
        + (item.timestamp ? '<dt>When</dt><dd>'   + relTime(item.timestamp) + '</dd>' : '')
        + '</dl>'
        + (item.url
            ? '<p><a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer" class="intel-link intel-drawer-ext">'
              + 'View on ' + esc(item.source === 'github' ? 'GitHub' : 'Jira') + ' \u2197</a></p>'
            : '');
    }

    var askBtn = document.getElementById('intel-drawer-ask');
    if (askBtn) askBtn.dataset.prompt = drawerPrompt(item);

    var boardLink = document.getElementById('intel-drawer-board-link');
    if (boardLink && typeof IntelState !== 'undefined') boardLink.href = IntelState.boardUrl();

    drawer.hidden = false;
    document.body.classList.add('intel-drawer-open');

    var closeBtn = document.getElementById('intel-drawer-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDrawer() {
    var drawer = document.getElementById('intel-drawer');
    if (drawer) drawer.hidden = true;
    document.body.classList.remove('intel-drawer-open');
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  function load() {
    if (!_orgId || _loading) return;
    _loading = true;

    var body = document.getElementById('intel-overview-body');
    if (body) body.innerHTML = skeletonHtml();

    fetch('/api/v1/orgs/' + encodeURIComponent(_orgId) + '/intelligence/overview')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _data = data;
        render(data);
      })
      .catch(function (e) {
        renderError(e.message || 'Unknown error');
      })
      .finally(function () {
        _loading = false;
      });
  }

  // ── Drawer event wiring (called once during init) ──────────────────────────

  function initDrawer() {
    document.getElementById('intel-drawer-close')
      ?.addEventListener('click', closeDrawer);
    document.getElementById('intel-drawer-backdrop')
      ?.addEventListener('click', closeDrawer);
    document.getElementById('intel-drawer-ask')
      ?.addEventListener('click', function () {
        var askBtn = document.getElementById('intel-drawer-ask');
        var prompt = (askBtn && askBtn.dataset.prompt) || '';
        if (prompt && typeof IntelState !== 'undefined') {
          IntelState.emit('seedQuery', prompt);
        }
        closeDrawer();
      });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var drawer = document.getElementById('intel-drawer');
        if (drawer && !drawer.hidden) closeDrawer();
      }
    });
  }

  // ── Board link sync ────────────────────────────────────────────────────────

  function syncBoardLinks() {
    if (typeof IntelState === 'undefined') return;
    var url = IntelState.boardUrl();
    var cta = document.getElementById('intel-board-cta');
    if (cta) cta.href = url;
    var drawerLink = document.getElementById('intel-drawer-board-link');
    if (drawerLink) drawerLink.href = url;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init(orgId) {
    _orgId = orgId;
    initDrawer();
    load();

    if (typeof IntelState !== 'undefined') {
      IntelState.on('queryComplete', load);
      IntelState.on('filterChanged', syncBoardLinks);
    }

    syncBoardLinks();
  }

  window.IntelOverview = { init: init, refresh: load };

})();
