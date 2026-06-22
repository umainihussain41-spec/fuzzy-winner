/**
 * Sarvam AI — Text-to-Speech (TTS)
 * Model: bulbul:v3 — natural Indian English accent
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 */

const axios = require('axios');

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

// Indian English voices available in bulbul:v3
// Options: anushka, manisha, vidya, arjun, abhilash, karun, hitesh
const SPEAKER = process.env.SARVAM_SPEAKER || 'anushka';
const LANGUAGE = process.env.SARVAM_LANGUAGE || 'en-IN';

/**
 * Convert text to speech using Sarvam Bulbul:v3 (Indian accent)
 * Returns a Buffer of raw PCM audio (8kHz, mono, µ-law) suitable for Exotel
 *
 * @param {string} text       - Text to synthesize (max 2500 chars)
 * @returns {Promise<Buffer>} - Raw PCM audio buffer
 */
async function textToSpeech(text) {
  if (!SARVAM_API_KEY) throw new Error('SARVAM_API_KEY not set in environment');
  if (!text || text.trim().length === 0) throw new Error('Empty text for TTS');

  // Sarvam supports max 2500 chars per request — split if needed
  const chunks = splitText(text, 2000);
  const audioBuffers = [];

  for (const chunk of chunks) {
    const buf = await synthesizeChunk(chunk);
    audioBuffers.push(buf);
  }

  return Buffer.concat(audioBuffers);
}

async function synthesizeChunk(text) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        SARVAM_TTS_URL,
        {
          inputs: [text],
          target_language_code: LANGUAGE,
          speaker: SPEAKER,
          model: 'bulbul:v3',
          properties: {
            pace: 1.0,
            pitch: 0,
            loudness: 1.5,
            speech_sample_rate: 8000,   // 8kHz for telephony (matches Exotel)
            enable_preprocessing: true,  // Handles numbers, abbreviations naturally
          },
        },
        {
          headers: {
            'api-subscription-key': SARVAM_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      // Response: { audios: ["<base64-wav>", ...] }
      const audios = response.data?.audios;
      if (!audios || audios.length === 0) {
        throw new Error('No audio in TTS response');
      }

      // Decode base64 WAV → strip WAV header → return raw PCM bytes
      const wavBuffer = Buffer.from(audios[0], 'base64');
      return stripWavHeader(wavBuffer);
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      if (status === 429) {
        const wait = Math.pow(2, attempt) * 600;
        console.warn(`[TTS] Rate limited, retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      console.error(`[TTS] Attempt ${attempt} failed:`, err.message);
      await sleep(400 * attempt);
    }
  }

  throw new Error(`TTS failed after 3 attempts: ${lastError?.message}`);
}

/**
 * Strip the 44-byte WAV header to get raw PCM bytes
 */
function stripWavHeader(wavBuffer) {
  // Standard WAV header is 44 bytes (for simple PCM)
  // Find 'data' chunk marker for robustness
  const dataMarker = wavBuffer.indexOf('data', 36);
  if (dataMarker === -1) return wavBuffer.slice(44);
  // data chunk: 4 bytes marker + 4 bytes size = skip 8 bytes after marker
  return wavBuffer.slice(dataMarker + 8);
}

/**
 * Split long text into chunks at sentence boundaries
 */
function splitText(text, maxLen) {
  if (text.length <= maxLen) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { textToSpeech };
