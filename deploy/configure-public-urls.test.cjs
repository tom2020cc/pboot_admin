const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeOrigin, updateEnv } = require('./configure-public-urls.cjs');

test('production origin validation rejects unsafe or ambiguous addresses', () => {
  assert.equal(normalizeOrigin('https://admin.example.com/'), 'https://admin.example.com');
  for (const input of ['http://example.com', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com/?a=1']) {
    assert.throws(() => normalizeOrigin(input));
  }
});
test('environment update preserves secrets and unrelated settings, removes duplicate managed keys', () => {
  const source = '# keep\nJWT_SECRET=existing-secret\nADMIN_PUBLIC_URL=old\nADMIN_PUBLIC_URL=duplicate\n';
  const values = { ADMIN_PUBLIC_URL: 'https://admin.example.com', SEO_PUBLIC_URL: 'https://seo.example.com' };
  const output = updateEnv(source, values);
  assert.match(output, /JWT_SECRET=existing-secret/);
  assert.equal(output.match(/ADMIN_PUBLIC_URL=/g).length, 1);
  assert.equal(updateEnv(output, values), output);
});
