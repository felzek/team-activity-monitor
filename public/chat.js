/**
 * Chat UI — client-side logic.
 *
 * Architecture:
 *  - Conversation history held in-memory (survives input clears, not page reloads)
 *  - Each message sent as POST /api/v1/chat with full history → stateless server
 *  - Tool calls are returned in the response and shown in a collapsible panel
 *  - Source badges show freshness (live vs cached) and provider (Jira/GitHub)
 *  - Partial failures surface as warning banners
 */

/* ── State ─────────────────────────────────────────────────────────────────── */
let conversationHistory = []; // { role: 'user'|'assistant', content: string }[]
let selectedModelId = '';
let isProcessing = false;
let csrfToken = '';

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const messagesInner = document.getElementById('messages-inner');
const messagesArea = document.getElementById('messages-area');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const modelSelector = document.getElementById('model-selector');
const statusText = document.getElementById('status-text');
const tokenCount = document.getElementById('token-count');
const welcomeState = document.getElementById('welcome-state');
const newChatBtn = document.getElementById('new-chat-btn');
const chatTitle = document.getElementById('chat-title');

/* ── Init ──────────────────────────────────────────────────────────────────── */
(async function init() {
  await loadCsrfToken();
  await loadModels();
  setupInputHandlers();
  setupSuggestionPills();
})();

async function loadCsrfToken() {
  try {
    const res = await fetch('/api/v1/auth/session');
    const data = await res.json();
    csrfToken = data.csrfToken ?? '';
  } catch (e) {
    console.error('Failed to load CSRF token', e);
  }
}

async function loadModels() {
  try {
    const res = await fetch('/api/llm/models', {
      headers: { 'x-csrf-token': csrfToken }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = data.models ?? [];

    modelSelector.innerHTML = '';

    if (models.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No models — add API key in Settings';
      opt.disabled = true;
      opt.selected = true;
      modelSelector.appendChild(opt);
      return;
    }

    for (const model of models) {
      if (!model.supportsTools) continue; // only show tool-capable models
      const opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = `${model.displayName} (${model.provider})`;
      modelSelector.appendChild(opt);
    }

    // If no tool-capable models, show all
    if (modelSelector.options.length === 0) {
      for (const model of models) {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = `${model.displayName} (${model.provider})`;
        modelSelector.appendChild(opt);
      }
    }

    selectedModelId = modelSelector.value;
    modelSelector.addEventListener('change', () => {
      selectedModelId = modelSelector.value;
    });
  } catch (e) {
    console.error('Failed to load models', e);
    modelSelector.innerHTML = '<option value="">Failed to load models</option>';
  }
}

function setupInputHandlers() {
  chatInput.addEventListener('input', () => {
    // Auto-resize textarea
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
    // Enable/disable send button
    sendBtn.disabled = !chatInput.value.trim() || isProcessing;
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  sendBtn.addEventListener('click', () => sendMessage());
  newChatBtn.addEventListener('click', () => newChat());
}

function setupSuggestionPills() {
  document.querySelectorAll('.suggestion-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const q = pill.getAttribute('data-q');
      if (q) {
        chatInput.value = q;
        chatInput.dispatchEvent(new Event('input'));
        sendMessage();
      }
    });
  });
}

/* ── Message sending ───────────────────────────────────────────────────────── */
async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || isProcessing) return;
  if (!selectedModelId) {
    showError('Select a model from the dropdown first.');
    return;
  }

  // Hide welcome state on first message
  if (welcomeState) welcomeState.style.display = 'none';

  // Update chat title on first message
  if (conversationHistory.length === 0) {
    chatTitle.textContent = text.length > 50 ? text.slice(0, 50) + '…' : text;
  }

  // Add user message to UI
  appendMessage('user', text);
  conversationHistory.push({ role: 'user', content: text });

  // Clear input
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  isProcessing = true;
  setStatus('Thinking…');

  // Add thinking indicator
  const thinkingEl = appendThinking();

  try {
    const res = await fetch('/api/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken
      },
      body: JSON.stringify({
        message: text,
        modelId: selectedModelId,
        // Only pass user/assistant turns (strip any tool turns that shouldn't be passed back)
        history: conversationHistory.slice(0, -1) // exclude the message we just added (server receives it as `message`)
      })
    });

    thinkingEl.remove();

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error ?? `HTTP ${res.status}`);
    }

    const result = await res.json();

    // Add assistant reply to conversation history
    conversationHistory.push({ role: 'assistant', content: result.answer });

    // Render assistant message with tool calls and source badges
    renderAssistantMessage(result);

    setStatus('Ready');
    tokenCount.textContent = result.tokenUsage
      ? `${(result.tokenUsage.input + result.tokenUsage.output).toLocaleString()} tokens`
      : '';
  } catch (err) {
    thinkingEl.remove();
    appendErrorMessage(err.message ?? 'Something went wrong. Please try again.');
    setStatus('Error');
  } finally {
    isProcessing = false;
    sendBtn.disabled = !chatInput.value.trim();
    scrollToBottom();
  }
}

/* ── Rendering ─────────────────────────────────────────────────────────────── */
function appendMessage(role, content) {
  const el = document.createElement('div');
  el.className = `message ${role}`;

  const header = document.createElement('div');
  header.className = 'message-header';

  const avatar = document.createElement('div');
  avatar.className = `message-avatar ${role}`;
  avatar.textContent = role === 'user' ? 'U' : 'AI';

  const name = document.createElement('span');
  name.textContent = role === 'user' ? 'You' : 'Assistant';

  header.appendChild(avatar);
  header.appendChild(name);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = formatMarkdown(content);

  el.appendChild(header);
  el.appendChild(body);
  messagesInner.appendChild(el);
  scrollToBottom();
  return el;
}

function renderAssistantMessage(result) {
  const el = document.createElement('div');
  el.className = 'message assistant';

  const header = document.createElement('div');
  header.className = 'message-header';
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar assistant';
  avatar.textContent = 'AI';
  const name = document.createElement('span');
  name.textContent = 'Assistant';
  header.appendChild(avatar);
  header.appendChild(name);

  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = formatMarkdown(result.answer);

  el.appendChild(header);
  el.appendChild(body);

  // Tool calls panel
  if (result.toolsUsed && result.toolsUsed.length > 0) {
    const toolPanel = buildToolCallsPanel(result);
    el.appendChild(toolPanel);
  }

  // Source badges
  if (result.sources && result.sources.length > 0) {
    const badges = buildSourceBadges(result.sources);
    el.appendChild(badges);
  }

  // Partial failure banners
  if (result.partialFailures && result.partialFailures.length > 0) {
    for (const failure of result.partialFailures) {
      const banner = document.createElement('div');
      banner.className = 'partial-failure-banner';
      banner.textContent = `⚠ ${failure.provider.toUpperCase()}: ${failure.message}`;
      el.appendChild(banner);
    }
  }

  // Stopped early warning
  if (result.stoppedEarly) {
    const banner = document.createElement('div');
    banner.className = 'partial-failure-banner';
    banner.textContent = '⚠ Answer may be incomplete — reached maximum tool call limit.';
    el.appendChild(banner);
  }

  messagesInner.appendChild(el);
  scrollToBottom();
}

function buildToolCallsPanel(result) {
  const uniqueTools = [...new Set(result.toolsUsed)];

  const panel = document.createElement('div');
  panel.className = 'tool-calls-panel';

  const toggle = document.createElement('div');
  toggle.className = 'tool-calls-toggle';
  toggle.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    <span>${uniqueTools.length} tool call${uniqueTools.length > 1 ? 's' : ''} · ${result.iterationCount} iteration${result.iterationCount > 1 ? 's' : ''}</span>
    <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
  `;

  const list = document.createElement('div');
  list.className = 'tool-calls-list';

  // Deduplicate and show each unique tool
  for (const toolName of uniqueTools) {
    const failureForTool = (result.partialFailures ?? []).find(f => f.tool === toolName);
    const item = document.createElement('div');
    item.className = 'tool-call-item';

    const icon = getToolIcon(toolName);
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tool-call-name';
    nameSpan.textContent = toolName;

    const status = document.createElement('span');
    status.className = `tool-call-status ${failureForTool ? 'error' : 'success'}`;
    status.innerHTML = failureForTool
      ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Failed`
      : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> OK`;

    item.appendChild(icon);
    item.appendChild(nameSpan);
    item.appendChild(status);
    list.appendChild(item);
  }

  toggle.addEventListener('click', () => {
    list.classList.toggle('open');
    const chevron = toggle.querySelector('.chevron');
    if (chevron) {
      chevron.style.transform = list.classList.contains('open') ? 'rotate(180deg)' : '';
    }
  });

  panel.appendChild(toggle);
  panel.appendChild(list);
  return panel;
}

function buildSourceBadges(sources) {
  const container = document.createElement('div');
  container.className = 'source-badges';

  // Deduplicate sources by provider+source combo
  const seen = new Set();
  for (const src of sources) {
    if (src.provider === 'internal') continue;
    const key = `${src.provider}-${src.source}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const badge = document.createElement('span');
    const isCached = src.source === 'cached';
    const ageLabel = isCached && src.cacheAgeMs != null
      ? ` · ${formatAge(src.cacheAgeMs)} old`
      : '';
    const countLabel = src.itemCount != null ? ` · ${src.itemCount} items` : '';

    badge.className = `source-badge ${src.provider} ${isCached ? 'cached' : 'live'}`;
    badge.innerHTML = `${getProviderIcon(src.provider)}<span>${src.provider.toUpperCase()}</span><span>${isCached ? '⏱ cached' : '⚡ live'}${ageLabel}${countLabel}</span>`;
    container.appendChild(badge);
  }

  return container;
}

function appendThinking() {
  const el = document.createElement('div');
  el.className = 'message assistant thinking-message';
  el.innerHTML = `
    <div class="message-header">
      <div class="message-avatar assistant">AI</div>
      <span>Assistant</span>
    </div>
    <div class="message-body">
      <div class="thinking-dots">
        <span></span><span></span><span></span>
      </div>
      <span style="color: var(--text-secondary); font-size: 13px;">Fetching live data…</span>
    </div>
  `;
  messagesInner.appendChild(el);
  scrollToBottom();
  return el;
}

function appendErrorMessage(text) {
  const el = document.createElement('div');
  el.className = 'message assistant error-message';
  el.innerHTML = `
    <div class="message-header">
      <div class="message-avatar assistant">AI</div>
      <span>Error</span>
    </div>
    <div class="message-body">${escapeHtml(text)}</div>
  `;
  messagesInner.appendChild(el);
  scrollToBottom();
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function newChat() {
  conversationHistory = [];
  messagesInner.innerHTML = '';
  if (welcomeState) {
    messagesInner.appendChild(welcomeState);
    welcomeState.style.display = '';
  }
  chatTitle.textContent = 'New conversation';
  tokenCount.textContent = '';
  setStatus('Ready');
}

function setStatus(text) {
  statusText.textContent = text;
}

function scrollToBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function formatAge(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m`;
}

function getProviderIcon(provider) {
  if (provider === 'jira') {
    return '<svg width="10" height="10" viewBox="0 0 24 24" fill="#4d94ff" style="flex-shrink:0"><path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 0 0-.84-.84H11.53zm-4.35 4.35c0 2.4 1.97 4.35 4.35 4.35h1.78v1.71c0 2.4 1.94 4.34 4.35 4.35V7.19a.84.84 0 0 0-.84-.84H7.18zm-4.35 4.35c0 2.4 1.97 4.35 4.35 4.35h1.78v1.71C4.01 16.76 5.95 18.7 8.35 18.71V11.54a.84.84 0 0 0-.84-.84H2.83z"/></svg>';
  }
  if (provider === 'github') {
    return '<svg width="10" height="10" viewBox="0 0 24 24" fill="#a78bfa" style="flex-shrink:0"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>';
  }
  return '';
}

function getToolIcon(toolName) {
  const icons = {
    resolve_person: '👤',
    search_jira_issues: '📋',
    get_github_commits: '💾',
    get_github_prs: '🔀',
    list_active_repos: '📁',
    get_team_members: '👥',
    summarize_team_activity: '📊'
  };
  const span = document.createElement('span');
  span.style.fontSize = '14px';
  span.textContent = icons[toolName] ?? '🔧';
  return span;
}

function showError(msg) {
  statusText.textContent = '⚠ ' + msg;
  setTimeout(() => { statusText.textContent = 'Ready'; }, 3000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal markdown renderer:
 *  ### heading  → <h3>
 *  **bold**     → <strong>
 *  `code`       → <code>
 *  - item       → <ul><li>
 *  [text](url)  → <a>
 *  blank line   → paragraph break
 */
function formatMarkdown(text) {
  if (!text) return '';

  const lines = text.split('\n');
  const result = [];
  let inList = false;

  for (const raw of lines) {
    let line = escapeHtml(raw);

    // Headings
    if (line.startsWith('### ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h3>${line.slice(4)}</h3>`);
      continue;
    }
    if (line.startsWith('## ')) {
      if (inList) { result.push('</ul>'); inList = false; }
      result.push(`<h3>${line.slice(3)}</h3>`);
      continue;
    }

    // List items
    const listMatch = line.match(/^[\-\*]\s+(.+)/);
    if (listMatch) {
      if (!inList) { result.push('<ul>'); inList = true; }
      result.push(`<li>${applyInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    if (inList) { result.push('</ul>'); inList = false; }

    if (line.trim() === '') {
      result.push('<br>');
    } else {
      result.push(`<p style="margin: 4px 0">${applyInlineMarkdown(line)}</p>`);
    }
  }

  if (inList) result.push('</ul>');
  return result.join('');
}

function applyInlineMarkdown(text) {
  return text
    // Bold **text**
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic *text*
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Code `text`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
