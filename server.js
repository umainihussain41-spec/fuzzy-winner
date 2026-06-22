/**
 * Exotel VoiceBot — Main Server
 * Handles HTTP + WebSocket connections from Exotel AgentStream
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const { handleExotelConnection } = require('./src/websocket/exotelHandler');
const axios = require('axios');

const app = express();
const server = http.createServer(app);

// ── Static admin dashboard ──────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Redirect root / to dashboard
app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// ── Active sessions store (for dashboard) ───────────────────────────────────
const activeSessions = new Map();
global.activeSessions = activeSessions;

// ── WebSocket servers ────────────────────────────────────────────────────────
// Exotel AgentStream connects here
const exotelWss = new WebSocketServer({ noServer: true });

// Dashboard clients connect here for live monitoring
const dashboardWss = new WebSocketServer({ noServer: true });
global.dashboardClients = new Set();

dashboardWss.on('connection', (ws) => {
  global.dashboardClients.add(ws);
  // Send current sessions snapshot on connect
  ws.send(JSON.stringify({ type: 'snapshot', sessions: serializeSessions() }));
  ws.on('close', () => global.dashboardClients.delete(ws));
});

// ── HTTP upgrade router ──────────────────────────────────────────────────────
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/stream') {
    // Exotel AgentStream endpoint
    exotelWss.handleUpgrade(request, socket, head, (ws) => {
      exotelWss.emit('connection', ws, request);
    });
  } else if (pathname === '/dashboard-ws') {
    // Admin dashboard live feed
    dashboardWss.handleUpgrade(request, socket, head, (ws) => {
      dashboardWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

exotelWss.on('connection', (ws, req) => {
  handleExotelConnection(ws, req);
});

// ── REST API for dashboard ───────────────────────────────────────────────────
app.get('/api/sessions', (req, res) => {
  res.json(serializeSessions());
});

app.post('/api/calls/trigger', async (req, res) => {
  const { to, appId } = req.body;
  if (!to || !appId) {
    return res.status(400).json({ error: 'Missing required parameters: to and appId' });
  }

  const {
    EXOTEL_ACCOUNT_SID,
    EXOTEL_API_KEY,
    EXOTEL_API_TOKEN,
    EXOTEL_CALLER_ID,
    EXOTEL_REGION = 'in'
  } = process.env;

  if (!EXOTEL_ACCOUNT_SID || !EXOTEL_API_KEY || !EXOTEL_API_TOKEN || !EXOTEL_CALLER_ID) {
    return res.status(500).json({ error: 'Exotel API credentials are not configured on the server.' });
  }

  const domain = EXOTEL_REGION === 'in' ? 'api.in.exotel.com' : 'api.exotel.com';
  const url = `https://${domain}/v1/Accounts/${EXOTEL_ACCOUNT_SID}/Calls/connect.json`;
  const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString('base64');

  const exotelBaseDomain = EXOTEL_REGION === 'in' ? 'my.exotel.in' : 'my.exotel.com';
  const flowUrl = `http://${exotelBaseDomain}/${EXOTEL_ACCOUNT_SID}/exoml/start_voice/${appId}`;

  const payload = new URLSearchParams({
    From: to,
    Url: flowUrl,
    CallerId: EXOTEL_CALLER_ID,
    CallType: 'trans'
  });

  try {
    const response = await axios.post(url, payload.toString(), {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const callDetails = response.data?.Call;
    if (callDetails) {
      res.json({
        success: true,
        callSid: callDetails.Sid,
        status: callDetails.Status,
        dateCreated: callDetails.DateCreated
      });
    } else {
      res.status(500).json({ error: 'Unexpected response from Exotel API', details: response.data });
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    res.status(error.response?.status || 500).json({
      error: 'Failed to initiate outbound call with Exotel',
      details: errorDetails
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeCalls: activeSessions.size,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    models: {
      llm: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      stt: 'saarika:v2',
      tts: 'bulbul:v3',
    },
  });
});

// ── Helper: broadcast to all dashboard clients ───────────────────────────────
function broadcastToDashboard(data) {
  const msg = JSON.stringify(data);
  for (const client of global.dashboardClients) {
    if (client.readyState === 1) client.send(msg);
  }
}
global.broadcastToDashboard = broadcastToDashboard;

function serializeSessions() {
  const result = [];
  for (const [id, session] of activeSessions) {
    result.push({
      id,
      callSid: session.callSid,
      from: session.from,
      startedAt: session.startedAt,
      turns: session.turns || [],
      scraperUsed: session.scraperUsed || false,
    });
  }
  return result;
}

// ── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🤖 Exotel VoiceBot Server started`);
  console.log(`   HTTP  → http://localhost:${PORT}`);
  console.log(`   WS    → ws://localhost:${PORT}/stream  (Exotel AgentStream)`);
  console.log(`   Dash  → http://localhost:${PORT}/dashboard.html`);
  console.log(`\n   LLM  : ${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'} via Groq`);
  console.log(`   STT  : Sarvam saarika:v2 (Indian English)`);
  console.log(`   TTS  : Sarvam bulbul:v3 (${process.env.SARVAM_LANGUAGE || 'en-IN'})`);
  console.log(`\n   Public URL: ${process.env.PUBLIC_WS_URL || 'Not set — run ngrok http ' + PORT}\n`);
});
