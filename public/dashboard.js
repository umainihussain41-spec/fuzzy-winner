/**
 * Dashboard WebSocket Client
 * Connects to /dashboard-ws for live events from the VoiceBot server.
 */

let ws = null;
let selectedSessionId = null;
let sessions = {};     // { id -> session }
let totalTurns = 0;
let totalScraper = 0;
let events = [];

// ── WebSocket connection ─────────────────────────────────────────────────────
function connectDashboard() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/dashboard-ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateWsBadge('connected', 'Live');
    addEvent('system', 'Dashboard connected');
    fetchHealth();
  };

  ws.onclose = () => {
    updateWsBadge('disconnected', 'Reconnecting…');
    setTimeout(connectDashboard, 3000);
  };

  ws.onerror = () => {
    updateWsBadge('error', 'Error');
  };

  ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      handleMessage(msg);
    } catch {}
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
      sessions = {};
      (msg.sessions || []).forEach((s) => { sessions[s.id] = s; });
      renderSessions();
      updateStats();
      break;

    case 'session_start':
      sessions[msg.session.id] = msg.session;
      addEvent('start', `Call started — ${msg.session.id} from ${msg.session.from || 'unknown'}`);
      renderSessions();
      updateStats();
      break;

    case 'session_end':
      delete sessions[msg.sessionId];
      addEvent('end', `Call ended — ${msg.sessionId}`);
      if (selectedSessionId === msg.sessionId) {
        selectedSessionId = null;
        document.getElementById('selectedSessionLabel').textContent = 'No call selected';
      }
      renderSessions();
      updateStats();
      break;

    case 'session_update':
      sessions[msg.session.id] = msg.session;
      renderSessions();
      break;

    case 'turn':
      if (!sessions[msg.sessionId]) break;
      if (!sessions[msg.sessionId].turns) sessions[msg.sessionId].turns = [];
      sessions[msg.sessionId].turns.push(
        { role: 'user', text: msg.transcript, at: new Date().toISOString() },
        { role: 'bot', text: msg.botResponse, at: new Date().toISOString(), scraperUsed: msg.scraperUsed }
      );
      if (msg.scraperUsed) {
        sessions[msg.sessionId].scraperUsed = true;
        totalScraper++;
        addEvent('scraper', `Live doc lookup for session ${msg.sessionId}`);
      }
      totalTurns++;
      addEvent('turn', `[${msg.sessionId}] User: "${truncate(msg.transcript, 40)}"`);
      updateStats();
      renderSessions();
      if (selectedSessionId === msg.sessionId) {
        renderTranscript(sessions[msg.sessionId]);
      }
      break;

    case 'log':
      addEvent(msg.level || 'info', msg.message);
      break;
  }
}

// ── Render sessions list ─────────────────────────────────────────────────────
function renderSessions() {
  const list = document.getElementById('sessionsList');
  const ids = Object.keys(sessions);

  document.getElementById('sessionCount').textContent = ids.length;

  if (ids.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📵</div>
        <p>No active calls right now.<br/>Configure your Exotel number to point to this bot.</p>
      </div>`;
    return;
  }

  list.innerHTML = ids.map((id) => {
    const s = sessions[id];
    const turnCount = s.turns ? Math.floor(s.turns.length / 2) : 0;
    const duration = timeSince(s.startedAt);
    const isSelected = id === selectedSessionId;
    return `
      <div class="session-card ${isSelected ? 'active' : ''}" onclick="selectSession('${id}')">
        <div class="session-card-header">
          <span class="session-id">${id}</span>
          <span class="session-status">Live</span>
        </div>
        <div class="session-meta">
          <span>📞 ${s.from || 'Unknown'}</span>
          <span>💬 ${turnCount} turn${turnCount !== 1 ? 's' : ''}</span>
          <span>⏱ ${duration}</span>
        </div>
        ${s.scraperUsed ? '<span class="scraper-badge">🔍 Doc lookup used</span>' : ''}
      </div>`;
  }).join('');
}

// ── Select a session and show transcript ─────────────────────────────────────
function selectSession(id) {
  selectedSessionId = id;
  renderSessions();
  const s = sessions[id];
  if (s) {
    document.getElementById('selectedSessionLabel').textContent = `Session ${id}`;
    renderTranscript(s);
  }
}

function renderTranscript(session) {
  const body = document.getElementById('transcriptBody');
  const turns = session.turns || [];

  if (turns.length === 0) {
    body.innerHTML = '<div class="transcript-placeholder">No turns yet — waiting for caller to speak</div>';
    return;
  }

  body.innerHTML = turns.map((turn) => `
    <div class="turn ${turn.role}">
      <div class="turn-label">
        ${turn.role === 'user' ? '🗣️ Caller' : '🤖 Asha'}
        ${turn.scraperUsed ? '<span style="font-size:10px;color:var(--yellow)">🔍 doc lookup</span>' : ''}
      </div>
      <div class="turn-bubble">${escapeHtml(turn.text)}</div>
      <div class="turn-time">${formatTime(turn.at)}</div>
    </div>
  `).join('');

  // Auto-scroll to bottom
  body.scrollTop = body.scrollHeight;
}

// ── Event feed ───────────────────────────────────────────────────────────────
function addEvent(type, message) {
  events.unshift({ type, message, at: new Date() });
  if (events.length > 100) events.pop();
  renderEvents();
}

function renderEvents() {
  const feed = document.getElementById('eventFeed');
  if (events.length === 0) {
    feed.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text3);font-size:12px;">Waiting for events…</div>';
    return;
  }
  feed.innerHTML = events.slice(0, 30).map((e) => `
    <div class="event-item">
      <span class="event-time">${formatTime(e.at, true)}</span>
      <span class="event-type ${e.type}">${e.type.toUpperCase()}</span>
      <span>${escapeHtml(e.message)}</span>
    </div>
  `).join('');
}

function clearEvents() {
  events = [];
  renderEvents();
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  document.getElementById('statActive').textContent = Object.keys(sessions).length;
  document.getElementById('statTurns').textContent = totalTurns;
  document.getElementById('statScraper').textContent = totalScraper;
}

async function fetchHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const uptimeSecs = Math.floor(data.uptime);
    document.getElementById('statUptime').textContent = formatUptime(uptimeSecs);
    document.getElementById('chip-llm').textContent = data.models?.llm || 'llama-3.3-70b';
  } catch {}
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    sessions = {};
    data.forEach((s) => { sessions[s.id] = s; });
    renderSessions();
    updateStats();
  } catch {}
}

// ── WS badge ─────────────────────────────────────────────────────────────────
function updateWsBadge(state, label) {
  const badge = document.getElementById('wsBadge');
  badge.className = `ws-badge ${state}`;
  document.getElementById('wsStatus').textContent = label;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

function formatTime(dateStr, short = false) {
  const d = new Date(dateStr);
  if (short) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function timeSince(dateStr) {
  const secs = Math.floor((Date.now() - new Date(dateStr)) / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h`;
}

function formatUptime(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

// ── Uptime ticker ─────────────────────────────────────────────────────────────
let serverStartTime = null;
async function startUptimeTicker() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    serverStartTime = Date.now() - data.uptime * 1000;
  } catch {}
  setInterval(() => {
    if (serverStartTime) {
      const secs = Math.floor((Date.now() - serverStartTime) / 1000);
      document.getElementById('statUptime').textContent = formatUptime(secs);
    }
  }, 1000);
}

// ── Outbound call triggering ──────────────────────────────────────────────────
async function triggerCall() {
  const numberInput = document.getElementById('callToNumber');
  const appIdInput = document.getElementById('callAppId');
  const btn = document.getElementById('btnTriggerCall');
  const statusDiv = document.getElementById('triggerStatus');

  const to = numberInput.value.trim();
  const appId = appIdInput.value.trim();

  if (!to || !appId) {
    showStatus('Please fill in both Phone Number and App Bazaar ID.', 'error');
    return;
  }

  // Save to localStorage
  localStorage.setItem('exotel_call_to', to);
  localStorage.setItem('exotel_app_id', appId);

  btn.disabled = true;
  btn.textContent = 'Initiating...';
  showStatus('Requesting Exotel to connect call...', 'info');

  try {
    const response = await fetch('/api/calls/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to, appId }),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      showStatus(`Call initiated! SID: ${result.callSid}`, 'success');
      addEvent('system', `Outbound call triggered to ${to} (SID: ${result.callSid})`);
    } else {
      const details = result.details ? (typeof result.details === 'object' ? JSON.stringify(result.details) : result.details) : '';
      showStatus(`❌ Failed: ${result.error || 'Unknown error'} ${details}`, 'error');
      console.error('Trigger call error:', result);
    }
  } catch (err) {
    showStatus(`❌ Network error: ${err.message}`, 'error');
    console.error('Trigger call network error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Initiate Call';
  }
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('triggerStatus');
  statusDiv.style.display = 'block';
  statusDiv.className = `call-status ${type}`;
  statusDiv.textContent = message;

  // Clear success messages after 8 seconds
  if (type === 'success') {
    setTimeout(() => {
      if (statusDiv.textContent === message) {
        statusDiv.style.display = 'none';
      }
    }, 8000);
  }
}

function restoreInputs() {
  const savedTo = localStorage.getItem('exotel_call_to');
  const savedAppId = localStorage.getItem('exotel_app_id');

  if (savedTo) document.getElementById('callToNumber').value = savedTo;
  if (savedAppId) document.getElementById('callAppId').value = savedAppId;
}

// ── Init ─────────────────────────────────────────────────────────────────────
connectDashboard();
startUptimeTicker();
restoreInputs();
