const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSharedGoogleAccount } = require('./google-shared-account');
const shared = { client_email: 'shared@example.com', private_key: 'test-only-key' };
const own = { client_email: 'own@example.com', private_key: 'test-only-own-key' };
const parse = value => {
  if (!value?.client_email || !value?.private_key) throw new Error('Invalid JSON');
  return value;
};
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-google-'));
  const file = path.join(root, 'google', 'account.json');
  try { run(createSharedGoogleAccount(file), file); }
  finally {
    assert(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('unconfigured websites share one saved key and reread rotations without a restart', () => fixture((store, file) => {
  assert.equal(store.resolve().enabled, false);
  store.configure({}, { serviceAccount: shared, shared: true }, parse);
  const siteA = { dailyQuota: 123 }, siteB = { dailyQuota: 456 };
  assert.deepEqual(store.resolve(siteA).serviceAccount, shared);
  assert.deepEqual(createSharedGoogleAccount(file).resolve(siteB).serviceAccount, shared);
  store.configure({}, { serviceAccount: own, shared: true }, parse);
  assert.deepEqual(store.resolve(siteA).serviceAccount, own);
  assert.equal(siteA.dailyQuota, 123);
  assert.equal(siteB.dailyQuota, 456);
}));
test('legacy dedicated accounts and keys remain independent until explicitly switched', () => fixture(store => {
  store.configure({}, { serviceAccount: shared, shared: true }, parse);
  for (const raw of [{ serviceAccount: own }, { clientEmail: own.client_email, privateKey: own.private_key }]) {
    assert.equal(store.resolve(raw).accountSource, 'site');
    assert.deepEqual(store.resolve(raw).serviceAccount, own);
    const switched = store.configure(raw, { useShared: true }, parse);
    assert.deepEqual(store.resolve(switched).serviceAccount, shared);
    assert(!switched.privateKey && !switched.serviceAccount);
  }
}));
test('promote existing account without JSON re-entry; keep site settings and one shared key', () => fixture(store => {
  const raw = { serviceAccount: own, clientEmail: own.client_email, privateKey: own.private_key, dailyQuota: 90 };
  const next = store.configure(raw, { promoteToShared: true }, parse);
  assert.equal(next.dailyQuota, 90);
  assert.equal(next.accountSource, 'shared');
  assert.equal(next.serviceAccount, null);
  assert(!next.privateKey);
  assert.deepEqual(store.resolve({}).serviceAccount, own);
  assert.deepEqual(store.status(), { configured: true, clientEmail: own.client_email });
  assert(!JSON.stringify(store.status()).includes('private_key'));
}));
test('disabling one website does not disable others or silently inherit again', () => fixture(store => {
  const raw = store.configure({}, { serviceAccount: shared, shared: true }, parse);
  const disabled = store.configure(raw, { clear: true }, parse);
  assert.equal(store.resolve(disabled).enabled, false);
  assert.equal(store.resolve({}).enabled, true);
  const restored = store.configure(disabled, { useShared: true }, parse);
  assert.equal(store.resolve(restored).enabled, true);
  const independent = store.configure(disabled, { serviceAccount: own }, parse);
  assert.equal(store.resolve(independent).clientEmail, own.client_email);
  assert.equal(store.status().clientEmail, shared.client_email);
}));
test('missing, invalid and corrupted shared credentials fail clearly without modifying the old account', () => fixture((store, file) => {
  assert.throws(() => store.configure({}, { useShared: true }, parse), /尚未配置/);
  assert.throws(() => store.configure({}, { promoteToShared: true }, parse));
  store.configure({}, { serviceAccount: shared, shared: true }, parse);
  assert.throws(() => store.configure({}, { serviceAccount: {}, shared: true }, parse));
  assert.equal(store.status().clientEmail, shared.client_email);
  fs.writeFileSync(file, '{invalid');
  assert.throws(() => store.resolve({}), /配置无效/);
  assert.equal(store.resolve({ serviceAccount: own }).clientEmail, own.client_email);
}));
