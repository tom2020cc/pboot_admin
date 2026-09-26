const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSharedYandexAccount } = require('./yandex-shared-account');
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yandex-shared-test-'));
  const file = path.join(root, 'shared', 'account.json');
  try { run(createSharedYandexAccount(file), file); }
  finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('new websites share credentials but retain independent domains and verification', () => fixture((store, file) => {
  const siteA = { siteUrl: 'https://a.example/', verification: { code: 'A' } };
  const siteB = { siteUrl: 'https://b.example/', verification: { code: 'B' } };
  const saved = store.configure(siteA, { shared: true, token: 'test-key' });
  assert.equal(saved.oauthToken, '');
  assert.equal(saved.siteUrl, siteA.siteUrl);
  assert.deepEqual(saved.verification, siteA.verification);
  assert.equal(createSharedYandexAccount(file).resolve(siteB).oauthToken, 'test-key');
  store.configure(saved, { shared: true, token: 'rotated-key' });
  assert.equal(store.resolve(siteB).oauthToken, 'rotated-key');
  assert.deepEqual(store.status(), { configured: true });
}));
test('legacy own credentials stay dedicated until explicitly promoted or switched', () => fixture(store => {
  store.configure({}, { shared: true, token: 'shared-key' });
  const legacy = { oauthToken: 'own-key', siteUrl: 'https://own.example/' };
  assert.equal(store.resolve(legacy).oauthToken, 'own-key');
  assert.equal(store.resolve(store.configure(legacy, { useShared: true })).oauthToken, 'shared-key');
  const promoted = store.configure(legacy, { promoteToShared: true });
  assert.equal(promoted.oauthToken, '');
  assert.equal(store.resolve({}).oauthToken, 'own-key');
}));
test('disable and re-enable one site without affecting shared users', () => fixture(store => {
  store.configure({}, { shared: true, token: 'shared-key' });
  const disabled = store.configure({}, { clear: true });
  assert.equal(store.resolve(disabled).configured, false);
  assert.equal(store.resolve({}).configured, true);
  assert.equal(store.resolve(store.configure(disabled, { useShared: true })).configured, true);
}));
test('invalid input and damaged shared file fail without silently selecting another account', () => fixture((store, file) => {
  assert.equal(store.resolve({}).configured, false);
  assert.throws(() => store.configure({}, { useShared: true }));
  store.configure({}, { shared: true, token: 'existing-key' });
  assert.throws(() => store.configure({}, { shared: true, token: ' ' }));
  assert.equal(store.resolve({}).oauthToken, 'existing-key');
  fs.writeFileSync(file, 'invalid');
  assert.throws(() => store.resolve({}), /配置无效/);
  assert.equal(store.resolve({ oauthToken: 'dedicated' }).oauthToken, 'dedicated');
}));
