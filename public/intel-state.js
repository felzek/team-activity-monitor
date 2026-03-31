/**
 * IntelState — shared filter state and event bus.
 *
 * Single source of truth for:
 *   person     — string | null  (team member name, null = whole team)
 *   timeRange  — "1d" | "7d" | "14d" | "30d"
 *   sources    — ("github" | "jira")[]
 *
 * Loaded on both /app (dashboard) and /intelligence (board) pages.
 * Script must be loaded before intel-overview.js and intelligence.js.
 *
 * URL encoding schema: ?person=alice&timeRange=7d&sources=github,jira
 * The board URL omits default values (timeRange=7d, both sources) for cleanliness.
 */
(function (global) {
  'use strict';

  var VALID_RANGES = ['1d', '7d', '14d', '30d'];
  var DEFAULT = { person: null, timeRange: '7d', sources: ['github', 'jira'] };

  var _filter = Object.assign({}, DEFAULT, { sources: DEFAULT.sources.slice() });
  var _bus = {};  // eventName -> fn[]

  // ── Event bus ──────────────────────────────────────────────────────────────

  function on(event, fn) {
    if (!_bus[event]) _bus[event] = [];
    _bus[event].push(fn);
    return function off() {
      _bus[event] = (_bus[event] || []).filter(function (f) { return f !== fn; });
    };
  }

  function emit(event, data) {
    var fns = _bus[event] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](data); } catch (_e) { /* guard — never let a subscriber crash the bus */ }
    }
  }

  // ── Filter state ───────────────────────────────────────────────────────────

  function getFilter() {
    return Object.assign({}, _filter, { sources: _filter.sources.slice() });
  }

  function setFilter(patch) {
    if (patch.person !== undefined)    _filter.person    = patch.person;
    if (patch.timeRange !== undefined) _filter.timeRange = patch.timeRange;
    if (patch.sources !== undefined)   _filter.sources   = patch.sources.slice();
    emit('filterChanged', getFilter());
  }

  function reset() {
    _filter = Object.assign({}, DEFAULT, { sources: DEFAULT.sources.slice() });
    emit('filterChanged', getFilter());
  }

  // ── URL encoding ───────────────────────────────────────────────────────────

  /**
   * Returns the URL for the intelligence board page with current filter state
   * encoded as query params.  Omits defaults so links stay readable.
   */
  function boardUrl() {
    var u = new URL('/intelligence', window.location.origin);
    if (_filter.person) {
      u.searchParams.set('person', _filter.person);
    }
    if (_filter.timeRange !== '7d') {
      u.searchParams.set('timeRange', _filter.timeRange);
    }
    var allSources = _filter.sources.includes('github') && _filter.sources.includes('jira');
    if (!allSources) {
      u.searchParams.set('sources', _filter.sources.join(','));
    }
    return u.toString();
  }

  /**
   * Reads URL query params into the current filter state.
   * Call on the board page (intelligence.html) during init to restore
   * filter context that was set on the dashboard before navigation.
   */
  function fromUrl() {
    var p = new URLSearchParams(window.location.search);
    if (p.has('person'))    _filter.person    = p.get('person') || null;
    if (p.has('timeRange') && VALID_RANGES.indexOf(p.get('timeRange')) !== -1) {
      _filter.timeRange = p.get('timeRange');
    }
    if (p.has('sources')) {
      var s = p.get('sources').split(',').filter(function (x) {
        return x === 'github' || x === 'jira';
      });
      if (s.length) _filter.sources = s;
    }
  }

  global.IntelState = { on: on, emit: emit, getFilter: getFilter, setFilter: setFilter, reset: reset, boardUrl: boardUrl, fromUrl: fromUrl };

})(window);
