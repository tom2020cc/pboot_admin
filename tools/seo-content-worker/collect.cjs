const path = require('node:path');
const { createRequire } = require('node:module');
const deps = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const sanitize = deps('sanitize-html');
const { sourceUrl, readPublicFeed, readPublicText, parseFeed } = require('./network.cjs');
const { researchKeyword } = require('./research.cjs');

function searchUrl(industry, keyword) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  // Quote literal user topics rather than interpreting search operators as instructions.
  const literal = value => String(value || '').replace(/["\\\r\n]/g, ' ').trim();
  url.searchParams.set('q', `"${literal(industry)}" "${literal(keyword)}"`);
  url.searchParams.set('count', '10');
  url.searchParams.set('text_decorations', 'false');
  url.searchParams.set('safesearch', 'moderate');
  return url.href;
}
function parseSearch(text, keywords) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('SEARCH_JSON_INVALID'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.web?.results)) {
    if (data && typeof data === 'object' && data.type === 'search' && !data.web) return [];
    throw new Error('SEARCH_JSON_INVALID');
  }
  return data.web.results.slice(0, 10).flatMap(item => {
    const title = sanitize(String(item.title || ''), { allowedTags: [], allowedAttributes: {} }).trim().slice(0, 200);
    if (!keywords.some(k => k.trim() && title.toLowerCase().includes(k.toLowerCase()))) return [];
    let url;
    try { url = sourceUrl(item.url); } catch { return []; }
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    if (url.href.length > 1000) return [];
    // Do not turn a search snippet into verified facts or guess its publication date.
    return [{ title, url: url.href, publishedAt: '' }];
  });
}
async function readSearch(url, signal) {
  const key = String(process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!key) throw new Error('SEARCH_KEY_NOT_CONFIGURED');
  try { return await readPublicText(url, signal, { Accept: 'application/json', 'X-Subscription-Token': key }); }
  catch (error) {
    if (/^SOURCE_HTTP_\d+$/.test(error.message)) throw new Error(error.message.replace('SOURCE_', 'SEARCH_'));
    throw error;
  }
}
function errorCode(error) {
  return /^(SEARCH_|SOURCE_|XML_|DNS_)[A-Z0-9_]+$/.test(error.message) ? error.message : 'SOURCE_FETCH_FAILED';
}
async function collectTitles(snapshot, signal, io = { feed: readPublicFeed, search: readSearch, research: researchKeyword }) {
  const sources = [], warnings = [];
  let succeeded = 0, tokens = 0;
  const tasks = snapshot.feeds.map(url => async () => parseFeed(await io.feed(url, signal), snapshot.keywords));
  if (snapshot.searchEnabled) {
    const keywords = (snapshot.searchKeywords || snapshot.keywords).slice(0, 3);
    for (const keyword of keywords) tasks.push(async () => {
      if (snapshot.searchProvider === 'deepseek') {
        const result = await (io.research || researchKeyword)(snapshot, keyword, signal);
        tokens += result.tokens || 0; return result.sources;
      }
      return parseSearch(await io.search(searchUrl(snapshot.industry, keyword), signal), snapshot.keywords);
    });
  }
  for (const task of tasks) {
    signal.throwIfAborted();
    try { sources.push(...await task()); succeeded++; }
    catch (error) { signal.throwIfAborted(); warnings.push(errorCode(error)); }
  }
  if (!succeeded) throw new Error(warnings[0] || 'SOURCE_NOT_CONFIGURED');
  return { sources: [...new Map(sources.map(s => [s.url, s])).values()].slice(0, 100), warnings: [...new Set(warnings)].slice(0, 12), tokens };
}
module.exports = { searchUrl, parseSearch, collectTitles };
