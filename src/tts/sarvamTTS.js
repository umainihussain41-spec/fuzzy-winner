/**
 * Sarvam AI — Text-to-Speech (TTS)
 * Model: bulbul:v3 — natural Indian English accent
 * Docs: https://docs.sarvam.ai/api-reference/text-to-speech
 */

const axios = require('axios');

const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

// Indian English voices available in bulbul:v3
// Common options: shubh, aditya, ritu, priya, neha, rahul, pooja, rohan, simran, kavya
const rawSpeaker = (process.env.SARVAM_SPEAKER || 'shubh').toLowerCase();
const BULBUL_V3_SPEAKERS = [
  'shubh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'rohan', 'simran',
  'kavya', 'amit', 'dev', 'ishita', 'shreya', 'ratan', 'varun', 'manan', 'sumit',
  'roopa', 'kabir', 'aayan', 'ashutosh', 'advait', 'anand', 'tanya', 'tarun',
  'sunny', 'mani', 'gokul', 'vijay', 'shruti', 'suhani', 'mohit', 'kavitha',
  'rehan', 'soham', 'rupali'
];

const speakerMap = {
  anushka: 'priya',
  manisha: 'shreya',
  vidya: 'pooja',
  arjun: 'rahul',
  abhilash: 'varun',
  karun: 'kabir',
  hitesh: 'mohit'
};

const SPEAKER = BULBUL_V3_SPEAKERS.includes(rawSpeaker)
  ? rawSpeaker
  : (speakerMap[rawSpeaker] || 'shubh');
const LANGUAGE = process.env.SARVAM_LANGUAGE || 'en-IN';

/**
 * Convert text to speech using Sarvam Bulbul:v3 (Indian accent)
 * Returns a Buffer of raw 16-bit PCM mono audio suitable for Exotel
 *
 * @param {string} text       - Text to synthesize (max 2500 chars)
 * @param {number} sampleRate - Target sample rate (default 24000Hz for best quality)
 * @returns {Promise<Buffer>} - Raw PCM audio buffer (16-bit signed, little-endian, mono)
 */
async function textToSpeech(text, sampleRate = 24000) {
  if (!SARVAM_API_KEY) throw new Error('SARVAM_API_KEY not set in environment');
  if (!text || text.trim().length === 0) throw new Error('Empty text for TTS');

  // Sarvam supports max 2500 chars per request — split if needed
  const chunks = splitText(text, 2000);
  const audioBuffers = [];

  for (const chunk of chunks) {
    const buf = await synthesizeChunk(chunk, sampleRate);
    audioBuffers.push(buf);
  }

  return Buffer.concat(audioBuffers);
}

/**
 * Returns the raw Sarvam WAV buffer at native quality (no resampling).
 * Used by the dashboard to play back TTS at full quality for comparison.
 *
 * @param {string} text - Text to synthesize
 * @returns {Promise<Buffer>} - Full WAV file buffer at 24kHz (Sarvam's best quality)
 */
async function textToSpeechRaw(text) {
  if (!SARVAM_API_KEY) return null;
  if (!text || text.trim().length === 0) return null;

  try {
    const firstChunk = splitText(text, 2000)[0];
    // Request at 24kHz — Sarvam's bulbul:v3 best quality output
    const response = await axios.post(
      SARVAM_TTS_URL,
      {
        inputs: [firstChunk],
        target_language_code: LANGUAGE,
        speaker: SPEAKER,
        model: 'bulbul:v3',
        speech_sample_rate: 24000,
        properties: { pace: 1.0 },
      },
      {
        headers: {
          'api-subscription-key': SARVAM_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );
    const audios = response.data?.audios;
    if (!audios || audios.length === 0) return null;
    // Return the full WAV buffer (with header) so browser can play it directly
    return Buffer.from(audios[0], 'base64');
  } catch (err) {
    console.warn('[TTS] textToSpeechRaw failed:', err.message);
    return null;
  }
}

async function synthesizeChunk(text, targetRate) {
  // Always request at 24kHz from Sarvam (bulbul:v3 native best quality).
  // extractAndResamplePcm reads the WAV header and resamples to targetRate if needed.
  const SARVAM_REQUEST_RATE = 24000;
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
          speech_sample_rate: SARVAM_REQUEST_RATE,
          properties: {
            pace: 1.0,
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

      // Decode base64 WAV → resample to targetRate if needed → raw PCM
      const wavBuffer = Buffer.from(audios[0], 'base64');
      return extractAndResamplePcm(wavBuffer, targetRate);
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
 * Parse a WAV buffer: validate sample rate, resample to targetRate if needed, return raw PCM.
 * This is critical — if Sarvam returns 24kHz audio but we send it to Exotel (which plays
 * at 8kHz), the audio plays 3× slower. We must resample to the exact target rate.
 */
function extractAndResamplePcm(wavBuffer, targetRate) {
  // Read sample rate from WAV header (bytes 24-27, little-endian uint32)
  if (wavBuffer.length < 44) return wavBuffer;

  const actualRate = wavBuffer.readUInt32LE(24);
  const numChannels = wavBuffer.readUInt16LE(22);
  const bitsPerSample = wavBuffer.readUInt16LE(34);

  // Find the 'data' chunk
  let dataOffset = 12;
  while (dataOffset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.slice(dataOffset, dataOffset + 4).toString('ascii');
    const chunkSize = wavBuffer.readUInt32LE(dataOffset + 4);
    if (chunkId === 'data') {
      dataOffset += 8;
      break;
    }
    dataOffset += 8 + chunkSize;
  }

  const pcmData = wavBuffer.slice(dataOffset);

  if (actualRate !== targetRate) {
    console.warn(`[TTS] Sample rate mismatch! Sarvam returned ${actualRate}Hz, Exotel needs ${targetRate}Hz — resampling...`);
    return resample16BitMono(pcmData, actualRate, targetRate);
  }

  return pcmData;
}

/**
 * Resample 16-bit signed little-endian mono PCM from sourceRate to targetRate.
 * Uses linear interpolation for good quality at low CPU cost.
 */
function resample16BitMono(pcmData, sourceRate, targetRate) {
  const srcSamples = pcmData.length / 2;
  const ratio = sourceRate / targetRate;
  const dstSamples = Math.floor(srcSamples / ratio);
  const output = Buffer.alloc(dstSamples * 2);

  for (let i = 0; i < dstSamples; i++) {
    const srcPos = i * ratio;
    const srcIdx = Math.floor(srcPos);
    const frac = srcPos - srcIdx;
    const nextIdx = Math.min(srcIdx + 1, srcSamples - 1);

    const a = pcmData.readInt16LE(srcIdx * 2);
    const b = pcmData.readInt16LE(nextIdx * 2);
    const interpolated = Math.round(a + frac * (b - a));
    const clamped = Math.max(-32768, Math.min(32767, interpolated));
    output.writeInt16LE(clamped, i * 2);
  }

  return output;
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

module.exports = { textToSpeech, textToSpeechRaw };
