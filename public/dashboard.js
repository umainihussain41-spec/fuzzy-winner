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

    case 'tts_audio':
      addTtsEntry(msg);
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

// ── TTS Audio Quality Comparison ───────────────────────────────────────────────────
let ttsEntries = [];

function addTtsEntry(msg) {
  ttsEntries.unshift(msg);
  if (ttsEntries.length > 30) ttsEntries.pop();

  const log = document.getElementById('ttsLog');

  // Build WAV blob URL for the Sarvam (24kHz) player
  const sarvamUrl = wavBlobUrl(msg.wavBase64);

  // Build a downsampled 8kHz WAV for the Exotel quality player
  const exotelUrl = buildExotelWavUrl(msg.wavBase64, msg.exotelSampleRate || 8000);

  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = 'tts-entry';
  entry.innerHTML = `
    <div class="tts-entry-label">
      <span>🤖 ${escapeHtml(msg.sessionId)} &nbsp;&middot;&nbsp; ${timeStr}</span>
      ${msg.isGreeting ? '<span class="tts-badge-greeting">GREETING</span>' : ''}
    </div>
    <div class="tts-entry-text">&ldquo;${escapeHtml(truncate(msg.text, 120))}&rdquo;</div>
    <div class="tts-players">
      <div class="tts-player-card sarvam">
        <div class="tts-player-title">🟣 Sarvam Direct</div>
        <div class="tts-player-sub">24 000 Hz &middot; Full quality TTS</div>
        ${sarvamUrl ? `<audio controls src="${sarvamUrl}"></audio>` : '<div style="font-size:11px;color:var(--red)">unavailable</div>'}
      </div>
      <div class="tts-player-card exotel">
        <div class="tts-player-title">🟠 Over Exotel</div>
        <div class="tts-player-sub">${msg.exotelSampleRate || 8000} Hz &middot; Phone line quality</div>
        ${exotelUrl ? `<audio controls src="${exotelUrl}"></audio>` : '<div style="font-size:11px;color:var(--red)">unavailable</div>'}
      </div>
    </div>
  `;

  // Clear placeholder if first entry
  if (ttsEntries.length === 1) log.innerHTML = '';
  log.insertBefore(entry, log.firstChild);
}

/** Decode base64 WAV and return a blob URL the browser can play */
function wavBlobUrl(base64) {
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch { return null; }
}

/**
 * Decode the Sarvam 24kHz WAV, linearly resample PCM to targetRate,
 * wrap it in a WAV header, and return a blob URL — simulating what
 * the caller hears over the Exotel 8kHz phone channel.
 */
function buildExotelWavUrl(base64, targetRate) {
  if (!base64) return null;
  try {
    const binary = atob(base64);
    const src = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) src[i] = binary.charCodeAt(i);

    // Read WAV header
    const srcRate   = src[24] | (src[25] << 8) | (src[26] << 16) | (src[27] << 24);
    const numCh     = src[22] | (src[23] << 8);
    const bitDepth  = src[34] | (src[35] << 8);

    // Find 'data' chunk
    let offset = 12;
    while (offset < src.length - 8) {
      const id = String.fromCharCode(src[offset], src[offset+1], src[offset+2], src[offset+3]);
      const sz = src[offset+4] | (src[offset+5] << 8) | (src[offset+6] << 16) | (src[offset+7] << 24);
      if (id === 'data') { offset += 8; break; }
      offset += 8 + sz;
    }

    const pcm = new Int16Array(src.buffer, offset, (src.length - offset) >> 1);

    // Resample using linear interpolation
    const ratio = srcRate / targetRate;
    const dstLen = Math.floor(pcm.length / ratio);
    const out = new Int16Array(dstLen);
    for (let i = 0; i < dstLen; i++) {
      const pos  = i * ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a = pcm[idx] || 0;
      const b = pcm[Math.min(idx + 1, pcm.length - 1)] || 0;
      out[i] = Math.round(a + frac * (b - a));
    }

    // Build WAV file
    const dataLen = out.byteLength;
    const buf = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buf);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0,  'RIFF');
    view.setUint32(4,  36 + dataLen,        true);
    writeStr(8,  'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16,                  true);
    view.setUint16(20, 1,                   true); // PCM
    view.setUint16(22, numCh || 1,          true);
    view.setUint32(24, targetRate,          true);
    view.setUint32(28, targetRate * 2,      true); // byte rate
    view.setUint16(32, 2,                   true); // block align
    view.setUint16(34, 16,                  true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataLen,             true);
    new Int16Array(buf, 44).set(out);

    const blob = new Blob([buf], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch (e) { console.warn('buildExotelWavUrl error', e); return null; }
}

function clearTtsLog() {
  ttsEntries = [];
  const log = document.getElementById('ttsLog');
  log.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text3);font-size:12px;">🎤 Waiting for bot to speak…</div>';
}

// ── Web Call Test ─────────────────────────────────────────────────────────────
let wcWs            = null;   // WebSocket to /stream
let wcStream        = null;   // MediaStream (mic)
let wcAudioCtx      = null;   // AudioContext for capture
let wcSourceNode    = null;
let wcProcessor     = null;
let wcPlayCtx       = null;   // AudioContext for playback
let wcNextPlayTime  = 0;
let wcActive        = false;
let wcBotSpeakTimer = null;
let wcState         = 'idle'; // idle | loading | listening | bot-speaking | error

function handleWebCallBtn() {
  if (wcState === 'idle' || wcState === 'error') startWebCall();
  else stopWebCall();
}

async function startWebCall() {
  setWcState('loading', '⏳ Requesting microphone…');
  try {
    wcStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    setWcState('error', `❌ Mic denied: ${err.message}`);
    return;
  }

  setWcState('loading', '⏳ Connecting to bot…');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  wcWs = new WebSocket(`${proto}//${location.host}/stream?sample-rate=24000`);

  wcWs.onopen = () => {
    wcActive = true;
    // Simulate Exotel handshake
    wcWs.send(JSON.stringify({ event: 'connected', protocol: 'web-test' }));
    wcWs.send(JSON.stringify({
      event: 'start',
      start: {
        call_sid:   'WEB_' + Date.now(),
        stream_sid: 'ST_'  + Date.now(),
        from:       'WEB_DASHBOARD',
        customParameters: { from: 'WEB_DASHBOARD' },
      },
    }));
    wcStartCapture();
    setWcState('listening', '🎙️ Listening — speak now, pause when done');
  };

  wcWs.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.event === 'media' && msg.media?.payload) {
        wcPlayChunk(msg.media.payload);
        setWcState('bot-speaking', '🤖 Bot speaking — listen…');
        clearTimeout(wcBotSpeakTimer);
        // Revert to listening ~600ms after last audio chunk
        wcBotSpeakTimer = setTimeout(() => {
          if (wcActive) setWcState('listening', '🎙️ Listening — speak now, pause when done');
        }, 600);
      }
    } catch {}
  };

  wcWs.onclose  = () => { if (wcActive) stopWebCall(); };
  wcWs.onerror  = () => { setWcState('error', '❌ WebSocket error'); stopWebCall(); };
}

function wcStartCapture() {
  wcAudioCtx   = new AudioContext();
  wcSourceNode = wcAudioCtx.createMediaStreamSource(wcStream);
  // ScriptProcessor: 4096 frames, 1 in, 1 out
  wcProcessor  = wcAudioCtx.createScriptProcessor(4096, 1, 1);

  wcProcessor.onaudioprocess = (evt) => {
    if (!wcWs || wcWs.readyState !== 1 || !wcActive) return;
    const f32     = evt.inputBuffer.getChannelData(0);
    const nativeSR = wcAudioCtx.sampleRate;
    const pcm8k   = wcDownsample(f32, nativeSR, 8000);
    const int16   = wcF32ToI16(pcm8k);
    const b64     = wcI16ToB64(int16);
    wcWs.send(JSON.stringify({ event: 'media', media: { payload: b64 } }));
  };

  wcSourceNode.connect(wcProcessor);
  wcProcessor.connect(wcAudioCtx.destination); // needed for ScriptProcessor to fire
}

function stopWebCall() {
  wcActive = false;
  clearTimeout(wcBotSpeakTimer);

  if (wcProcessor)  { wcProcessor.disconnect();  wcProcessor  = null; }
  if (wcSourceNode) { wcSourceNode.disconnect();  wcSourceNode = null; }
  if (wcAudioCtx)   { wcAudioCtx.close();         wcAudioCtx   = null; }
  if (wcStream)     { wcStream.getTracks().forEach(t => t.stop()); wcStream = null; }
  if (wcWs && wcWs.readyState <= 1) {
    try { wcWs.send(JSON.stringify({ event: 'stop' })); } catch {}
    wcWs.close();
  }
  wcWs         = null;
  wcPlayCtx    = null;
  wcNextPlayTime = 0;
  setWcState('idle', 'Ready — click the mic to begin');
}

function wcPlayChunk(base64) {
  try {
    const bin   = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const i16  = new Int16Array(bytes.buffer);
    const f32  = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768.0;

    // Use default AudioContext — Web Audio upsamples internally from 8kHz buffer
    if (!wcPlayCtx) {
      wcPlayCtx     = new AudioContext();
      wcNextPlayTime = wcPlayCtx.currentTime + 0.05;
    }

    const buf = wcPlayCtx.createBuffer(1, f32.length, 8000);
    buf.getChannelData(0).set(f32);

    const src = wcPlayCtx.createBufferSource();
    src.buffer = buf;
    src.connect(wcPlayCtx.destination);

    const now = wcPlayCtx.currentTime;
    if (wcNextPlayTime < now) wcNextPlayTime = now + 0.05;
    src.start(wcNextPlayTime);
    wcNextPlayTime += buf.duration;
  } catch (e) { console.warn('[WebCall] Playback error:', e); }
}

// ── Audio helpers ────────────────────────────────────────────────────────────
function wcDownsample(input, srcRate, dstRate) {
  if (srcRate === dstRate) return input;
  const ratio  = srcRate / dstRate;
  const outLen = Math.floor(input.length / ratio);
  const out    = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos  = i * ratio;
    const idx  = Math.floor(pos);
    const frac = pos - idx;
    const a    = input[idx]  || 0;
    const b    = input[Math.min(idx + 1, input.length - 1)] || 0;
    out[i]     = a + frac * (b - a);
  }
  return out;
}

function wcF32ToI16(f32) {
  const i16 = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    i16[i]  = s < 0 ? s * 32768 : s * 32767;
  }
  return i16;
}

function wcI16ToB64(i16) {
  const bytes  = new Uint8Array(i16.buffer);
  let   binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function setWcState(state, statusText) {
  wcState = state;
  const btn    = document.getElementById('webCallBtn');
  const label  = document.getElementById('webCallStateLabel');
  const ring   = document.getElementById('webCallRing');
  const status = document.getElementById('webCallStatusRow');

  if (!btn) return;

  // Button icon + class
  const icons = { idle: '🎤', loading: '⏳', listening: '🛑', 'bot-speaking': '🛑', error: '🎤' };
  btn.textContent = icons[state] || '🎤';
  btn.className   = 'webcall-mic-btn ' + (
    state === 'listening'    ? 'active' :
    state === 'bot-speaking' ? 'bot-speaking' :
    state === 'loading'      ? 'loading' :
    state === 'error'        ? '' : ''
  );

  // State label
  const labels = { idle: 'Idle', loading: 'Connecting…', listening: 'Listening', 'bot-speaking': 'Bot Speaking', error: 'Error' };
  label.textContent = labels[state] || state;
  label.className   = `webcall-state-label ${state}`;

  // Ring animation
  ring.className = 'webcall-ring ' + (state === 'listening' || state === 'bot-speaking' ? state : '');

  // Status text
  if (status) {
    status.textContent = statusText || '';
    status.className   = `webcall-status-row ${state}`;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────
connectDashboard();
startUptimeTicker();
restoreInputs();

