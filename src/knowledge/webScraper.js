/**
 * Web Scraper — Exotel Support & Developer Portal Fallback
 * Fetches live content from Exotel's official portals when the
 * built-in knowledge base doesn't have a specific answer.
 *
 * Targets:
 *   - https://support.exotel.com
 *   - https://developer.exotel.com
 *   - https://exotel.com
 */

const axios = require('axios');
const cheerio = require('cheerio');

// In-memory cache: { url -> { text, expiresAt } }
const pageCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const SEARCH_TARGETS = [
  'https://support.exotel.com',
  'https://developer.exotel.com',
  'https://exotel.com',
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; ExotelVoiceBot/1.0; Internal Support Tool)',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Search Exotel support content for a given query.
 * Returns the most relevant cleaned text (max ~2000 chars).
 *
 * @param {string} query  - User's question
 * @returns {Promise<string>} - Scraped content or empty string
 */
async function searchExotelDocs(query) {
  console.log(`[Scraper] Searching Exotel docs for: "${query}"`);

  // Try support search first (most likely to have relevant articles)
  const supportResult = await trySupportSearch(query);
  if (supportResult) return supportResult;

  // Fallback to developer portal search
  const devResult = await tryDeveloperSearch(query);
  if (devResult) return devResult;

  // Generic site search as last resort
  return '';
}

/**
 * Search support.exotel.com
 */
async function trySupportSearch(query) {
  const searchUrl = `https://support.exotel.com/support/search?term=${encodeURIComponent(query)}&utf8=%E2%9C%93`;

  try {
    const html = await fetchPage(searchUrl);
    const $ = cheerio.load(html);

    // Find first search result article link
    const firstLink = $('a.article-list-link, .search-results a, h3.summary a').first().attr('href');
    if (!firstLink) {
      // If no results page, try scraping the main support page
      return await scrapeArticlePage('https://support.exotel.com', query);
    }

    const articleUrl = firstLink.startsWith('http')
      ? firstLink
      : `https://support.exotel.com${firstLink}`;

    return await scrapeArticlePage(articleUrl, query);
  } catch (err) {
    console.warn(`[Scraper] Support search failed:`, err.message);
    return '';
  }
}

/**
 * Search developer.exotel.com
 */
async function tryDeveloperSearch(query) {
  // Developer portal typically uses URL-based navigation
  const slug = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .slice(0, 3)
    .join('-');

  const urls = [
    `https://developer.exotel.com/api/#${slug}`,
    `https://developer.exotel.com/api/`,
  ];

  for (const url of urls) {
    try {
      const text = await scrapeArticlePage(url, query);
      if (text && text.length > 100) return text;
    } catch {
      continue;
    }
  }

  return '';
}

/**
 * Fetch and clean a page, extracting article body text
 */
async function scrapeArticlePage(url, query) {
  const cached = pageCache.get(url);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`[Scraper] Cache hit: ${url}`);
    return extractRelevantSection(cached.text, query);
  }

  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  // Remove nav, footer, sidebars, ads
  $('nav, header, footer, .sidebar, .navigation, .breadcrumb, script, style, .ads, .cookie-banner, .feedback-widget').remove();

  // Extract main content
  const contentSelectors = [
    'article',
    '.article-body',
    '.content-body',
    '.doc-content',
    'main',
    '.main-content',
    '#main-content',
    '.container',
  ];

  let text = '';
  for (const selector of contentSelectors) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 200) {
      text = el.text();
      break;
    }
  }

  if (!text) {
    text = $('body').text();
  }

  // Clean whitespace
  text = text
    .replace(/\t/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Cache result
  pageCache.set(url, { text, expiresAt: Date.now() + CACHE_TTL_MS });

  return extractRelevantSection(text, query);
}

/**
 * Extract the section of text most relevant to the query (max 2000 chars)
 */
function extractRelevantSection(fullText, query) {
  if (!fullText || fullText.length === 0) return '';

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const paragraphs = fullText.split(/\n{2,}/);

  // Score each paragraph by keyword matches
  const scored = paragraphs.map((para) => {
    const lower = para.toLowerCase();
    const score = keywords.reduce((s, kw) => s + (lower.includes(kw) ? 1 : 0), 0);
    return { para, score };
  });

  // Sort by relevance
  scored.sort((a, b) => b.score - a.score);

  // Collect top paragraphs up to 2000 chars
  let result = '';
  for (const { para, score } of scored) {
    if (score === 0) break;
    if ((result + para).length > 2000) break;
    result += para + '\n\n';
  }

  // Fallback: just return the first 2000 chars
  if (!result && fullText.length > 0) {
    result = fullText.slice(0, 2000);
  }

  return result.trim();
}

/**
 * Fetch raw HTML of a URL with caching
 */
async function fetchPage(url) {
  const response = await axios.get(url, {
    headers: HEADERS,
    timeout: 10000,
    maxRedirects: 5,
    validateStatus: (s) => s < 400,
  });
  return response.data;
}

/**
 * Clear stale cache entries
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pageCache.entries()) {
    if (now > val.expiresAt) pageCache.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = { searchExotelDocs };
