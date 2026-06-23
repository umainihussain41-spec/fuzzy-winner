/**
 * Exotel AgentStream WebSocket Handler
 * Manages the full lifecycle of a bidirectional audio call.
 *
 * Exotel WebSocket Message Types (inbound):
 *   connected  — initial handshake
 *   start      — call metadata (callSid, streamSid, etc.)
 *   media      — audio chunk (base64-encoded raw 16-bit signed PCM mono)
 *   dtmf       — keypress event
 *   mark       — acknowledgement of sent mark
 *   clear      — barge-in: stop current TTS immediately
 *   stop       — call ended
 */

const { randomUUID } = require('crypto');
const { runPipeline } = require('../pipeline');

// VAD: collect audio until silence detected for VAD_SILENCE_MS
const VAD_SILENCE_MS = parseInt(process.env.VAD_SILENCE_MS || '700', 10);
function handleExotelConnection(ws, req) {
  const urlObj = new URL(req.url || '', 'http://localhost');
  const sampleRateParam = urlObj.searchParams.get('sample-rate') || urlObj.searchParams.get('sample_rate') || '8000';
  const sampleRate = parseInt(sampleRateParam, 10);
  const bytesPerMs = (sampleRate / 1000) * 2;

  const sessionId = randomUUID().slice(0, 8);
  console.log(`[${sessionId}] New Exotel connection | sample-rate: ${sampleRate}Hz`);

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
    sampleRate,
    bytesPerMs,

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
        session.callSid = msg.start?.call_sid || msg.start?.callSid || msg.call_sid || msg.callSid || 'unknown';
        session.streamSid = msg.stream_sid || msg.streamSid || msg.start?.stream_sid || msg.start?.streamSid;
        session.from = msg.start?.customParameters?.from || msg.start?.from || 'unknown';
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

        // Discard audio while bot is speaking — prevents Exotel echo loop
        // (Exotel reflects our own TTS audio back as caller audio)
        if (session.isSpeaking) {
          session.audioChunks = []; // flush any partial buffer too
          break;
        }

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
    if (session.isProcessing) {
      console.log(`[${session.id}] VAD fired but isProcessing=true — skipping`);
      return;
    }

    // Collect buffered audio
    let audioBuffer = Buffer.concat(session.audioChunks);
    session.audioChunks = [];
    session.silenceTimer = null;

    // Minimum audio threshold: ignore very short clips (< 300ms)
    const minBytes = session.bytesPerMs * 300;
    if (audioBuffer.length < minBytes) {
      console.log(`[${session.id}] Audio too short (${audioBuffer.length} bytes < ${minBytes}) — skipping`);
      return;
    }

    // Check RMS energy — skip if audio is near-silent (no actual speech)
    const rms = computeRms(audioBuffer);
    console.log(`[${session.id}] Audio RMS energy: ${rms.toFixed(1)} (threshold: 80) | ${audioBuffer.length} bytes`);
    if (rms < 80) {
      console.log(`[${session.id}] Skipping — audio below RMS threshold (silence/noise)`);
      return;
    }

    session.isProcessing = true;
    console.log(`[${session.id}] ▶ Pipeline start — ${audioBuffer.length} bytes`);

    try {
      const { transcript, botResponse, scraperUsed } = await runPipeline(
        audioBuffer,
        session.conversationHistory,
        session.id,
        session.sampleRate
      );

      if (!transcript || transcript.trim().length < 2) {
        console.log(`[${session.id}] Empty transcript — discarding turn`);
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

      // ── Release isProcessing BEFORE speaking so caller audio isn't blocked ──
      session.isProcessing = false;
      await speakResponse(ws, session, botResponse, false);
    } catch (err) {
      console.error(`[${session.id}] Pipeline error:`, err.message, err.stack);
      session.isProcessing = false;
      await speakResponse(ws, session,
        "I'm sorry, I ran into an issue. Could you please repeat that?", false);
    }
  }, VAD_SILENCE_MS);
}

// ── Send TTS audio back to Exotel ───────────────────────────────────────────
async function speakResponse(ws, session, text, isGreeting) {
  const { textToSpeech, textToSpeechRaw } = require('../tts/sarvamTTS');

  let aborted = false;
  session.currentSpeakAbort = () => { aborted = true; };
  session.isSpeaking = true;
  console.log(`[${session.id}] TTS start${isGreeting ? ' (greeting)' : ''}: "${text.slice(0, 60)}..."`);

  try {
    // Fetch Exotel-format audio first (critical path), then raw WAV for dashboard
    const audioBuffer = await textToSpeech(text, session.sampleRate);
    console.log(`[${session.id}] TTS done — ${audioBuffer.length} bytes at ${session.sampleRate}Hz`);

    // Fire-and-forget: fetch raw WAV for dashboard (don't block call audio on this)
    textToSpeechRaw(text).then((rawWavBuffer) => {
      if (rawWavBuffer && global.broadcastToDashboard) {
        global.broadcastToDashboard({
          type: 'tts_audio',
          sessionId: session.id,
          text,
          isGreeting: !!isGreeting,
          wavBase64: rawWavBuffer.toString('base64'),
          exotelSampleRate: session.sampleRate,
        });
      }
    }).catch((err) => console.warn(`[${session.id}] TTS raw (dashboard) failed:`, err.message));

    if (aborted) {
      console.log(`[${session.id}] TTS aborted before streaming`);
      return;
    }

    // Calculate chunk size dynamically based on sample rate (~200ms chunk)
    // Satisfies Exotel's constraints:
    //   1. Payload size must be between 3,200 and 100,000 bytes
    //   2. Chunk size must always be a multiple of 320 bytes
    const targetDurationSec = 0.200; // 200ms
    let rawChunkSize = Math.floor(session.sampleRate * 2 * targetDurationSec);
    let CHUNK_SIZE = Math.round(rawChunkSize / 320) * 320;
    if (CHUNK_SIZE < 3200) CHUNK_SIZE = 3200;
    if (CHUNK_SIZE > 100000) CHUNK_SIZE = 100000;

    const msPerChunk = (CHUNK_SIZE / (session.sampleRate * 2)) * 1000;

    const startTime = Date.now();
    let chunksSent = 0;

    for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
      if (aborted || ws.readyState !== 1) break;

      let chunk = audioBuffer.slice(i, i + CHUNK_SIZE);

      // If last chunk is smaller than CHUNK_SIZE, pad it with PCM silence (0)
      if (chunk.length < CHUNK_SIZE) {
        const padding = Buffer.alloc(CHUNK_SIZE - chunk.length, 0);
        chunk = Buffer.concat([chunk, padding]);
      }

      ws.send(JSON.stringify({
        event: 'media',
        streamSid: session.streamSid,
        stream_sid: session.streamSid,
        media: {
          payload: chunk.toString('base64'),
        },
      }));

      chunksSent++;

      // Calculate next send time and compensate for event loop drift
      const nextSendTime = startTime + (chunksSent * msPerChunk);
      const delay = nextSendTime - Date.now();

      if (delay > 0) {
        // Stream slightly ahead (85% of target delay) to avoid buffer starvation
        await sleep(delay * 0.85);
      }
    }

    if (!aborted && ws.readyState === 1) {
      // Send mark to know when audio playback finishes
      ws.send(JSON.stringify({
        event: 'mark',
        streamSid: session.streamSid,
        stream_sid: session.streamSid,
        mark: { name: `tts_done_${Date.now()}` },
      }));
    }
  } catch (err) {
    console.error(`[${session.id}] TTS error:`, err.message);
  } finally {
    session.isSpeaking = false;
    session.currentSpeakAbort = null;
    console.log(`[${session.id}] 🎙️  Listening — bot finished speaking`);
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

/**
 * Compute RMS (Root Mean Square) energy of a 16-bit mono PCM buffer.
 * Returns a value from 0 (silence) to 32767 (full scale).
 */
function computeRms(pcmBuffer) {
  const numSamples = pcmBuffer.length / 2;
  if (numSamples === 0) return 0;
  let sumOfSquares = 0;
  for (let i = 0; i < numSamples; i++) {
    if (i * 2 + 1 >= pcmBuffer.length) break;
    const sample = pcmBuffer.readInt16LE(i * 2);
    sumOfSquares += sample * sample;
  }
  return Math.sqrt(sumOfSquares / numSamples);
}

module.exports = { handleExotelConnection };
