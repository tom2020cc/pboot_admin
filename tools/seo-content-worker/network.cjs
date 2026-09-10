const https = require('node:https');
const dns = require('node:dns/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const deps = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const ipaddr = deps('ipaddr.js');
const { XMLParser } = deps('fast-xml-parser');
const plain = deps('sanitize-html');

function isPublicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
function sourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('SOURCE_URL_NOT_ALLOWED');
  return url;
}
async function readPublicText(value, signal, headers = {}) {
  const url = sourceUrl(value);
  let timer;
  const addresses = await Promise.race([
    dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), 5000); }),
  ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('SOURCE_NETWORK_NOT_ALLOWED');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the validated address to the actual connection; never follow redirects.
    const req = https.get(url, {
      signal, timeout: 15000, agent: false,
      headers: { 'User-Agent': 'PbootContentResearch/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'Accept-Encoding': 'identity', ...headers },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    }, res => {
      if (res.statusCode !== 200) { res.resume(); req.destroy(new Error(`SOURCE_HTTP_${res.statusCode}`)); return; }
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { req.destroy(new Error('SOURCE_ENCODING_NOT_ALLOWED')); return; }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) req.destroy(new Error('SOURCE_TOO_LARGE'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('SOURCE_TIMEOUT')));
    req.on('error', reject);
  });
}
const readPublicFeed = (value, signal) => readPublicText(value, signal);
function parseFeed(xml, keywords) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML_DECLARATION_NOT_ALLOWED');
  const tree = new XMLParser({ ignoreAttributes: false, processEntities: false }).parse(xml);
  const list = tree?.rss?.channel?.item || tree?.feed?.entry || [];
  const items = Array.isArray(list) ? list : [list];
  const text = value => plain(String(value?.['#text'] ?? value ?? ''), { allowedTags: [], allowedAttributes: {} }).trim();
  return items.slice(0, 300).flatMap(item => {
    const title = text(item.title).slice(0, 200);
    if (!keywords.some(k => k.trim() && title.toLowerCase().includes(k.toLowerCase()))) return [];
    const links = Array.isArray(item.link) ? item.link : [item.link];
    const link = links.find(l => typeof l === 'string' || !l?.['@_rel'] || l['@_rel'] === 'alternate');
    const url = typeof link === 'string' ? link : link?.['@_href'];
    try { sourceUrl(url); } catch { return []; }
    const date = Date.parse(text(item.pubDate || item.published || item.updated));
    const notes = text(item.summary || item.description || '').slice(0, 600);
    return [{ title, url: String(url).slice(0, 1000), publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : '',
      ...(notes ? { notes: `RSS 文字摘要（待核实）：\n${notes}` } : {}) }];
  }).slice(0, 100);
}
module.exports = { isPublicAddress, sourceUrl, readPublicFeed, readPublicText, parseFeed };
