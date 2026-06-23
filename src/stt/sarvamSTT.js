/**
 * Sarvam AI — Speech-to-Text (STT)
 * Model: saarika:v2 — optimized for Indian English and Indian-accented speech
 * Docs: https://docs.sarvam.ai/api-reference/speech-to-text
 */

const axios = require('axios');
const FormData = require('form-data');

const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text';
const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

/**
 * Convert raw PCM (16-bit mono 8kHz, from Exotel) buffer to text transcript.
 * Sarvam expects WAV format, so we wrap the PCM in a WAV header.
 *
 * @param {Buffer} audioBuffer  - Raw audio bytes from Exotel
 * @param {string} [lang]       - Language code (default: en-IN)
 * @returns {Promise<string>}   - Transcript string
 */
async function speechToText(audioBuffer, lang = 'en-IN') {
  if (!SARVAM_API_KEY) throw new Error('SARVAM_API_KEY not set in environment');

  // Wrap raw PCM in WAV container (8kHz, mono, 16-bit PCM)
  const wavBuffer = buildWavHeader(audioBuffer, 8000, 1, 16);

  const form = new FormData();
  form.append('file', wavBuffer, {
    filename: 'audio.wav',
    contentType: 'audio/wav',
  });
  form.append('model', 'saarika:v2.5');
  form.append('language_code', lang);
  form.append('with_timestamps', 'false');

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(SARVAM_STT_URL, form, {
        headers: {
          ...form.getHeaders(),
          'api-subscription-key': SARVAM_API_KEY,
        },
        timeout: 15000,
      });

      const transcript = response.data?.transcript || '';
      return transcript.trim();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      if (status === 429) {
        // Rate limit — exponential backoff
        const wait = Math.pow(2, attempt) * 500;
        console.warn(`[STT] Rate limited, retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (status === 400) {
        // Bad request — audio likely too short or malformed
        console.warn(`[STT] Bad request (audio too short?):`, err.response?.data);
        return '';
      }

      console.error(`[STT] Attempt ${attempt} failed:`, err.message);
      await sleep(500 * attempt);
    }
  }

  throw new Error(`STT failed after 3 attempts: ${lastError?.message}`);
}

/**
 * Build a WAV file buffer from raw PCM data.
 * Exotel sends 16-bit Linear PCM which we wrap in a WAV header for Sarvam STT.
 */
function buildWavHeader(pcmData, sampleRate, numChannels, bitsPerSample) {
  const dataSize = pcmData.length;
  const header = Buffer.allocUnsafe(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                              // PCM chunk size
  header.writeUInt16LE(1, 20);                               // Audio format: PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);  // Byte rate
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);               // Block align
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { speechToText };
