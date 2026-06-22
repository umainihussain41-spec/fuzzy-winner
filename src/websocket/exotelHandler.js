/**
 * Exotel AgentStream WebSocket Handler
 * Manages the full lifecycle of a bidirectional audio call.
 *
 * Exotel WebSocket Message Types (inbound):
 *   connected  — initial handshake
 *   start      — call metadata (callSid, streamSid, etc.)
 *   media      — audio chunk (base64-encoded µ-law / PCM)
 *   dtmf       — keypress event
 *   mark       — acknowledgement of sent mark
 *   clear      — barge-in: stop current TTS immediately
 *   stop       — call ended
 */

const { randomUUID } = require('crypto');
const { runPipeline } = require('../pipeline');

// VAD: collect audio until silence detected for VAD_SILENCE_MS
const VAD_SILENCE_MS = parseInt(process.env.VAD_SILENCE_MS || '700', 10);
const SAMPLE_RATE = 8000;           // Exotel uses 8kHz µ-law (G.711)
const BYTES_PER_MS = SAMPLE_RATE / 1000;  // 8 bytes per ms at 8kHz

function handleExotelConnection(ws, req) {
  const sessionId = randomUUID().slice(0, 8);
  console.log(`[${sessionId}] New Exotel connection`);

  // ── Session state ──────────────────────────────────────────────────────────
  const session = {
    id: sessionId,
    callSid: null,
    streamSid: null,
    from: null,
    startedAt: new Date().toISOString(),
    conversationHistory: [],
    turns: [],
    scraperUsed: false,

    // Audio buffering
    audioChunks: [],
    silenceTimer: null,
    isProcessing: false,
    isSpeaking: false,    // bot is currently sending audio

    // Interrupt control
    currentSpeakAbort: null,
  };

  global.activeSessions.set(sessionId, session);
  global.broadcastToDashboard({ type: 'session_start', session: serializeSession(session) });

  // ── WebSocket message handler ──────────────────────────────────────────────
  ws.on('message', async (rawMsg) => {
    let msg;
    try {
      msg = JSON.parse(rawMsg);
    } catch {
      return;
    }

    switch (msg.event) {
      case 'connected':
        console.log(`[${sessionId}] Connected — protocol: ${msg.protocol}`);
        break;

      case 'start': {
        session.callSid = msg.start?.callSid || msg.callSid || 'unknown';
        session.streamSid = msg.start?.streamSid || msg.streamSid;
        session.from = msg.start?.customParameters?.from || 'unknown';
        console.log(`[${sessionId}] Call started — SID: ${session.callSid}, From: ${session.from}`);

        global.broadcastToDashboard({
          type: 'session_update',
          session: serializeSession(session),
        });

        // Greet the caller
        await speakResponse(ws, session,
          'Hello! Welcome to Exotel internal support. How can I help you today?', true);
        break;
      }

      case 'media': {
        if (session.isProcessing || !msg.media?.payload) break;

        // Decode base64 audio and buffer it
        const chunk = Buffer.from(msg.media.payload, 'base64');
        session.audioChunks.push(chunk);

        // Reset silence timer on each chunk
        resetSilenceTimer(ws, session);
        break;
      }

      case 'dtmf': {
        console.log(`[${sessionId}] DTMF: ${msg.dtmf?.digit}`);
        break;
      }

      case 'clear': {
        // Caller interrupted — abort current TTS stream
        console.log(`[${sessionId}] Barge-in detected — clearing TTS`);
        session.isSpeaking = false;
        if (session.currentSpeakAbort) {
          session.currentSpeakAbort();
          session.currentSpeakAbort = null;
        }
        break;
      }

      case 'stop': {
        console.log(`[${sessionId}] Call ended`);
        cleanup(session);
        global.activeSessions.delete(sessionId);
        global.broadcastToDashboard({ type: 'session_end', sessionId });
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[${sessionId}] WebSocket closed`);
    cleanup(session);
    global.activeSessions.delete(sessionId);
    global.broadcastToDashboard({ type: 'session_end', sessionId });
  });

  ws.on('error', (err) => {
    console.error(`[${sessionId}] WS Error:`, err.message);
  });
}

// ── VAD: reset silence timer ────────────────────────────────────────────────
function resetSilenceTimer(ws, session) {
  if (session.silenceTimer) clearTimeout(session.silenceTimer);

  session.silenceTimer = setTimeout(async () => {
    if (session.audioChunks.length === 0) return;
    if (session.isProcessing) return;

    // Collect buffered audio
    const audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];
    session.silenceTimer = null;

    // Minimum audio threshold: ignore very short clips (< 300ms)
    if (audioBuffer.length < BYTES_PER_MS * 300) return;

    session.isProcessing = true;
    console.log(`[${session.id}] Processing ${audioBuffer.length} bytes of audio...`);

    try {
      const { transcript, botResponse, scraperUsed } = await runPipeline(
        audioBuffer,
        session.conversationHistory,
        session.id
      );

      if (!transcript || transcript.trim().length < 2) {
        session.isProcessing = false;
        return;
      }

      console.log(`[${session.id}] 🗣️  User: "${transcript}"`);
      console.log(`[${session.id}] 🤖  Bot : "${botResponse}"`);

      // Store turn
      session.turns.push({ role: 'user', text: transcript, at: new Date().toISOString() });
      session.turns.push({ role: 'bot', text: botResponse, at: new Date().toISOString() });
      if (scraperUsed) session.scraperUsed = true;

      global.broadcastToDashboard({
        type: 'turn',
        sessionId: session.id,
        transcript,
        botResponse,
        scraperUsed,
      });

      await speakResponse(ws, session, botResponse, false);
    } catch (err) {
      console.error(`[${session.id}] Pipeline error:`, err.message);
      await speakResponse(ws, session,
        "I'm sorry, I ran into an issue. Could you please repeat that?", false);
    } finally {
      session.isProcessing = false;
    }
  }, VAD_SILENCE_MS);
}

// ── Send TTS audio back to Exotel ───────────────────────────────────────────
async function speakResponse(ws, session, text, isGreeting) {
  const { textToSpeech } = require('../tts/sarvamTTS');

  let aborted = false;
  session.currentSpeakAbort = () => { aborted = true; };
  session.isSpeaking = true;

  try {
    const audioBuffer = await textToSpeech(text);
    if (aborted) return;

    // Send audio in 20ms chunks (160 bytes at 8kHz)
    const CHUNK_SIZE = 160;
    for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
      if (aborted || ws.readyState !== 1) break;

      const chunk = audioBuffer.slice(i, i + CHUNK_SIZE);
      ws.send(JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        media: {
          payload: chunk.toString('base64'),
        },
      }));

      // Pace the chunks to match real-time audio (20ms per chunk at 8kHz)
      await sleep(20);
    }

    if (!aborted && ws.readyState === 1) {
      // Send mark to know when audio playback finishes
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid: session.streamSid,
        mark: { name: `tts_done_${Date.now()}` },
      }));
    }
  } catch (err) {
    console.error(`[${session.id}] TTS error:`, err.message);
  } finally {
    session.isSpeaking = false;
    session.currentSpeakAbort = null;
  }
}

// ── Cleanup ─────────────────────────────────────────────────────────────────
function cleanup(session) {
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  if (session.currentSpeakAbort) session.currentSpeakAbort();
}

// ── Serialize session for dashboard ─────────────────────────────────────────
function serializeSession(s) {
  return {
    id: s.id,
    callSid: s.callSid,
    from: s.from,
    startedAt: s.startedAt,
    turns: s.turns,
    scraperUsed: s.scraperUsed,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { handleExotelConnection };
