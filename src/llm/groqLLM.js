/**
 * Groq LLM — Llama-3.3-70b (free tier)
 * OpenAI-compatible API at https://api.groq.com
 * Docs: https://console.groq.com/docs
 */

const axios = require('axios');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

/**
 * Call Groq LLM with conversation history.
 *
 * @param {string} systemPrompt         - Full system prompt (with knowledge base)
 * @param {Array}  conversationHistory  - [{role, content}, ...]
 * @param {string} userMessage          - Current user utterance
 * @returns {Promise<string>}           - Bot response text
 */
async function callLLM(systemPrompt, conversationHistory, userMessage) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY not set in environment');

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await axios.post(
        GROQ_API_URL,
        {
          model: GROQ_MODEL,
          messages,
          temperature: 0.4,
          max_tokens: 300,        // Keep responses concise for voice
          top_p: 0.9,
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${GROQ_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content || '';
      return cleanForVoice(content.trim());
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      if (status === 429) {
        // Groq free tier rate limit
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '2', 10);
        const wait = Math.max(retryAfter * 1000, Math.pow(2, attempt) * 800);
        console.warn(`[LLM] Rate limited (429), retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      if (status === 400) {
        console.error(`[LLM] Bad request:`, err.response?.data);
        throw new Error('LLM bad request — check message format');
      }

      console.error(`[LLM] Attempt ${attempt} failed:`, err.message);
      await sleep(500 * attempt);
    }
  }

  throw new Error(`LLM failed after 4 attempts: ${lastError?.message}`);
}

/**
 * Call LLM with a supplemental web-scraped context injected.
 * Used when the primary answer is insufficient.
 */
async function callLLMWithContext(systemPrompt, conversationHistory, userMessage, extraContext) {
  const augmentedSystem = systemPrompt + `

=== LIVE EXOTEL SUPPORT CONTENT (just fetched) ===
${extraContext}
=== END LIVE CONTENT ===

Use the above live content to answer the user's question accurately. Prefer this over your own knowledge if there's a conflict.`;

  return callLLM(augmentedSystem, conversationHistory, userMessage);
}

/**
 * Remove markdown, special chars that sound bad in TTS
 */
function cleanForVoice(text) {
  return text
    .replace(/#{1,6}\s/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold
    .replace(/\*(.+?)\*/g, '$1')        // italic
    .replace(/`(.+?)`/g, '$1')          // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // markdown links → text only
    .replace(/https?:\/\/\S+/g, '')     // bare URLs (unpronounceable)
    .replace(/\n{2,}/g, '. ')           // paragraph breaks → pause
    .replace(/\n/g, ' ')                // single newlines
    .replace(/\s{2,}/g, ' ')            // multiple spaces
    .trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { callLLM, callLLMWithContext };
