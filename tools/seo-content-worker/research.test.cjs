const { test } = require('node:test');
const assert = require('node:assert/strict');
const { researchRequest, parseResearch, researchKeyword } = require('./research.cjs');
const { modelRequest } = require('./model.cjs');
const { writingMessages } = require('./index.cjs');
const { collectTitles } = require('./collect.cjs');
const snapshot = { industry: '钻机', keywords: ['岩芯钻机'], researchModel: 'deepseek-v4-flash', maxOutputTokens: 2000,
  existingTitles: ['岩芯钻机选型'], knowledge: '不应发给搜索任务的私有资料', products: [{ id: 1, title: '产品秘密' }],
  editorial: { version: 'fixture', rules: [{ id: 'research', text: '研究规则测试' }, { id: 'writing', text: '写作规则测试' }] } };
const source = { title: '岩芯钻机工作原理', url: 'https://example.com/core', notes: '待核实的原理资料，不是仅有标题', publishedAt: '' };
const response = (sources = [source]) => ({ status: 'completed', usage: { input_tokens: 100, output_tokens: 200 }, output: [
  { type: 'web_search_call', status: 'completed' },
  { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ sources }), annotations: [{ type: 'url_citation', url: source.url }] }] },
] });
test('DeepSeek research uses the Responses search tool, limits output and sends no product facts, keys or images', () => {
  const body = researchRequest(snapshot, '岩芯钻机');
  assert.equal(body.max_output_tokens, 2000);
  assert.deepEqual(body.tools, [{ type: 'web_search' }]);
  assert.match(body.instructions, /研究规则测试/);
  assert.match(body.instructions, /不能只凭标题/);
  assert.doesNotMatch(body.input, /产品秘密|私有资料/);
  assert.throws(() => researchRequest({ ...snapshot, researchModel: 'untrusted' }, '关键词'), /SEARCH_MODEL_NOT_SUPPORTED/);
});
test('only accepts completed real search calls with matching citations; unknown links and images are excluded', () => {
  const parsed = parseResearch(response(), ['岩芯钻机']);
  assert.equal(parsed.tokens, 300);
  assert.match(parsed.sources[0].notes, /待核实/);
  assert.equal(parsed.sources[0].url, source.url);
  const unknown = { ...source, url: 'https://example.com/invented' };
  assert.deepEqual(parseResearch(response([source, unknown]), ['岩芯钻机']).sources.map(s => s.url), [source.url]);
  const noTool = response(); noTool.output.shift();
  assert.throws(() => parseResearch(noTool, ['岩芯钻机']), /SEARCH_NO_TOOL_CALL/);
  const noCitation = response(); noCitation.output[1].content[0].annotations = [];
  assert.throws(() => parseResearch(noCitation, ['岩芯钻机']), /SEARCH_NO_CITATIONS/);
  assert.throws(() => parseResearch({ ...response(), status: 'incomplete' }, ['岩芯钻机']), /TRUNCATED/);
  const imageSource = { ...source, url: 'https://example.com/a.jpg' };
  const image = response([imageSource]); image.output[1].content[0].annotations[0].url = imageSource.url;
  assert.throws(() => parseResearch(image, ['岩芯钻机']), /SEARCH_NO_CITATIONS/);
  assert.deepEqual(parseResearch(response([]), ['岩芯钻机']).sources, []);
});
test('successful DeepSeek transport sends credentials only to the fixed API, blocks redirects and never logs error bodies', async () => {
  let calls = 0;
  const result = await researchKeyword(snapshot, '岩芯钻机', new AbortController().signal, { key: 'fixture-key', fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/responses');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    return new Response(JSON.stringify(response()), { status: 200 });
  } });
  assert.equal(calls, 1); assert.equal(result.sources.length, 1);
  await assert.rejects(researchKeyword(snapshot, '岩芯钻机', new AbortController().signal, { key: 'fixture', fetch: async () => new Response('secret-error-body', { status: 429 }) }), /^Error: SEARCH_HTTP_429$/);
});
test('bounds response size, honors abort, and does not silently fall back or retry paid research', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(modelRequest('https://api.deepseek.com/responses', {}, 'fixture', controller.signal, 'SEARCH', () => { throw new Error('must not fetch'); }), /abort/i);
  await assert.rejects(modelRequest('https://api.deepseek.com/responses', {}, 'fixture', new AbortController().signal, 'SEARCH', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /SEARCH_OUTPUT_TOO_LARGE/);
  let calls = 0;
  await assert.rejects(collectTitles({ ...snapshot, feeds: [], searchProvider: 'deepseek', searchEnabled: true, searchKeywords: ['岩芯钻机'] }, new AbortController().signal,
    { research: async () => { calls++; throw new Error('SEARCH_HTTP_429'); } }), /SEARCH_HTTP_429/);
  assert.equal(calls, 1);
});
test('partial research keeps successful text and usage, not just titles', async () => {
  const result = await collectTitles({ ...snapshot, feeds: [], searchProvider: 'deepseek', searchEnabled: true, searchKeywords: ['岩芯钻机', '其他'] }, new AbortController().signal,
    { research: async (_snapshot, keyword) => { if (keyword === '其他') throw new Error('SEARCH_HTTP_503'); return { sources: [source], tokens: 250 }; } });
  assert.equal(result.tokens, 250); assert.deepEqual(result.warnings, ['SEARCH_HTTP_503']); assert.equal(result.sources[0].notes, source.notes);
});
test('writing uses rules and previous text without transmitting existing media URLs to the model', () => {
  const prompt = writingMessages({ ...snapshot, source: { notes: '事实' }, previous: { id: 7, draft: { content: '<p>[[SEO_MEDIA_1]]</p>' }, media: ['<img src="/private.jpg">'] } });
  assert.match(prompt[0].content, /写作规则测试/);
  assert.match(prompt[1].content, /SEO_MEDIA_1/);
  assert.doesNotMatch(prompt[1].content, /private\.jpg|"media"/);
});
