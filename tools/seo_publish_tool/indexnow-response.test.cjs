const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the actual request handler without starting the local HTTP server.
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const handlers = source.slice(source.indexOf('function isIndexNowVerificationPending('), source.indexOf('async function pushIndexNow('));
async function submit(status, body = '') {
  const context = vm.createContext({
    AbortSignal,
    wait: async () => {},
    fetch: async () => ({ ok: status >= 200 && status < 300, status, statusText: '', text: async () => body }),
  });
  vm.runInContext(handlers, context);
  return context.submitIndexNowPayload('https://api.indexnow.org/indexnow', { urlList: ['https://example.com/'] });
}

test('IndexNow 200 counts as accepted, not indexed', async () => {
  const result = await submit(200);
  assert.equal(result.ok, true);
  assert.equal(result.pending, false);
  assert.equal(result.pushed, 1);
});
test('IndexNow 202 remains pending and never inflates success count', async () => {
  const result = await submit(202);
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.pushed, 0);
  assert.equal(result.attempts, 1);
});
test('verification-pending errors stay distinct from both acceptance and permanent failures', async () => {
  const result = await submit(403, JSON.stringify({ errorCode: 'SiteVerificationNotCompleted' }));
  assert.equal(result.ok, false);
  assert.equal(result.pending, true);
  assert.equal(result.pushed, 0);
});
test('invalid-key errors are failures without automatic repeated submission', async () => {
  const result = await submit(403, JSON.stringify({ errorCode: 'InvalidKey' }));
  assert.equal(result.ok, false);
  assert.equal(result.pending, false);
  assert.equal(result.pushed, 0);
  assert.equal(result.attempts, 1);
});
