const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ai = require('./ai-seo');

const ready = '{"ok":true,"message":"connection-ready"}';
const completion = (content = ready, finish = 'stop') => new Response(JSON.stringify({
  choices: [{ message: { content }, finish_reason: finish }],
}));
function fixture(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-connection-'));
  fs.writeFileSync(path.join(root, 'ai.config.json'), JSON.stringify({ deepseekApiKey: 'fixture-not-a-key' }));
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return respond(calls.length, options);
  });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, calls, health: () => ai.getAiSettings(root).models.find(m => m.value === 'deepseek-chat') };
}

test('DeepSeek probe enables JSON mode, adequate tokens and repairs a failed health check', async t => {
  const f = fixture(t, () => completion());
  fs.writeFileSync(path.join(f.root, 'ai.model-health.json'), JSON.stringify({ models: { 'deepseek-chat': { status: 'failed' } } }));
  const result = await ai.testAiConnection(f.root, 'deepseek-chat');
  assert.equal(result.ok, true); assert.equal(result.attempts, 1);
  assert.deepEqual(f.calls[0].body.response_format, { type: 'json_object' });
  assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' });
  assert.equal(f.calls[0].body.max_tokens, 256);
  assert.equal(f.health().healthStatus, 'ok'); assert.equal(f.health().operational, true);
});

for (const bad of ['{"ok":#true}', '{"ok":<|TOKEN_12|>true}', '', '{"ok":true}', '[true]']) {
  test(`retries malformed or unexpected probe output: ${bad || '(empty)'}`, async t => {
    const f = fixture(t, n => completion(n === 1 ? bad : ready));
    assert.equal((await ai.testAiConnection(f.root, 'deepseek-chat')).attempts, 2);
    assert.equal(f.calls[1].body.max_tokens, 512);
    assert.equal(f.health().healthStatus, 'ok');
  });
}

test('persistent malformed output fails safely, without exposing generated content', async t => {
  const f = fixture(t, () => completion('{"ok":#true,"secret":"never-echo-this"}'));
  await assert.rejects(ai.testAiConnection(f.root, 'deepseek-chat'), e => {
    assert.equal(e.code, 'AI_MODEL_JSON'); assert.match(e.message, /API Key/);
    assert.doesNotMatch(e.message, /never-echo|Unexpected token/); return true;
  });
  assert.equal(f.calls.length, 2); assert.equal(f.health().operational, false);
});

for (const status of [401, 402, 429, 503]) {
  test(`HTTP ${status} is not hidden by output retries`, async t => {
    const f = fixture(t, () => new Response('{"error":{"message":"fixture error"}}', { status }));
    await assert.rejects(ai.testAiConnection(f.root, 'deepseek-chat'), new RegExp(String(status)));
    assert.equal(f.calls.length, 1); assert.equal(f.health().healthStatus, 'failed');
  });
}

test('invalid upstream JSON is distinguished from generated JSON and retried once', async t => {
  const f = fixture(t, n => n === 1 ? new Response('<html>gateway</html>') : completion());
  assert.equal((await ai.testAiConnection(f.root, 'deepseek-chat')).attempts, 2);
});

test('even valid JSON is rejected when the provider reports truncated output', async t => {
  const f = fixture(t, n => completion(ready, n === 1 ? 'length' : 'stop'));
  assert.equal((await ai.testAiConnection(f.root, 'deepseek-chat')).attempts, 2);
});

test('ordinary SEO array requests keep their existing payload contract', async t => {
  const f = fixture(t, () => completion('[{"id":1,"title":"test"}]'));
  const result = await ai._test.callAiOnce(f.root, 'deepseek-chat', 'Return JSON', 'Return an array');
  assert.ok(Array.isArray(result)); assert.equal(f.calls[0].body.response_format, undefined);
  assert.equal(f.calls[0].body.thinking, undefined);
});

test('the deadline covers response body streaming after headers arrive', async t => {
  const f = fixture(t, (_n, options) => ({ ok: true, status: 200, text: () => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) }));
  await assert.rejects(ai._test.callAiOnce(f.root, 'deepseek-chat', 'JSON', 'JSON', { timeoutMs: 20 }), { name: 'AbortError' });
  assert.equal(f.calls.length, 1);
});
