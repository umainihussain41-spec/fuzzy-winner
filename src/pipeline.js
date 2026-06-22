/**
 * Pipeline Orchestrator
 * Connects STT → LLM → (optional scraper) → response text
 *
 * Flow:
 *   1. audio Buffer → Sarvam STT → transcript
 *   2. transcript → Groq LLM (with Exotel knowledge) → response
 *   3. If LLM triggers SEARCH_NEEDED → scrape Exotel docs → re-call LLM
 *   4. Return { transcript, botResponse, scraperUsed }
 */

const { speechToText } = require('./stt/sarvamSTT');
const { callLLM, callLLMWithContext } = require('./llm/groqLLM');
const { searchExotelDocs } = require('./knowledge/webScraper');
const { buildSystemPrompt } = require('./config/systemPrompt');

const SEARCH_TRIGGER = /^SEARCH_NEEDED:\s*(.+)/i;

/**
 * Run the full STT → LLM → (scraper) pipeline for one audio turn.
 *
 * @param {Buffer} audioBuffer          - Raw PCM audio from Exotel
 * @param {Array}  conversationHistory  - [{role, content}, ...] — mutated in place
 * @param {string} sessionId            - For logging
 * @returns {Promise<{transcript, botResponse, scraperUsed}>}
 */
async function runPipeline(audioBuffer, conversationHistory, sessionId) {
  const log = (msg) => console.log(`[Pipeline:${sessionId}] ${msg}`);

  // ── Step 1: Speech → Text ──────────────────────────────────────────────────
  log('Running STT...');
  const transcript = await speechToText(audioBuffer);

  if (!transcript || transcript.trim().length < 2) {
    log('STT returned empty transcript — skipping');
    return { transcript: '', botResponse: '', scraperUsed: false };
  }
  log(`STT: "${transcript}"`);

  // ── Step 2: LLM — first pass ───────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt();
  log('Calling LLM (first pass)...');

  let botResponse = await callLLM(systemPrompt, conversationHistory, transcript);
  log(`LLM raw: "${botResponse}"`);

  // ── Step 3: Check for SEARCH_NEEDED trigger ────────────────────────────────
  let scraperUsed = false;
  const searchMatch = botResponse.match(SEARCH_TRIGGER);

  if (searchMatch) {
    const searchQuery = searchMatch[1].trim();
    log(`Scraper triggered — query: "${searchQuery}"`);

    try {
      const scrapedContent = await searchExotelDocs(searchQuery);

      if (scrapedContent && scrapedContent.length > 50) {
        log(`Scraper returned ${scrapedContent.length} chars — calling LLM again`);
        scraperUsed = true;

        botResponse = await callLLMWithContext(
          systemPrompt,
          conversationHistory,
          transcript,
          scrapedContent
        );
        log(`LLM (with context): "${botResponse}"`);
      } else {
        // Scraper found nothing — give a graceful fallback
        log('Scraper returned no useful content');
        botResponse = `I don't have specific details on that right now. For accurate information, you can reach Exotel support at hello at exotel dot in, or call plus 91 80 8891 9888. You can also check support dot exotel dot com directly.`;
      }
    } catch (err) {
      log(`Scraper failed: ${err.message} — using fallback`);
      botResponse = `I wasn't able to look that up right now. Please check support dot exotel dot com or reach out to hello at exotel dot in for detailed help on that.`;
    }
  }

  // Clean up any remaining SEARCH_NEEDED artefacts
  botResponse = botResponse.replace(SEARCH_TRIGGER, '').trim();

  // ── Step 4: Update conversation history ────────────────────────────────────
  conversationHistory.push({ role: 'user', content: transcript });
  conversationHistory.push({ role: 'assistant', content: botResponse });

  // Keep history bounded (last 10 turns = 20 messages)
  if (conversationHistory.length > 20) {
    conversationHistory.splice(0, conversationHistory.length - 20);
  }

  return { transcript, botResponse, scraperUsed };
}

module.exports = { runPipeline };
