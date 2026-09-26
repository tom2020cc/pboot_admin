const { test } = require('node:test');
const assert = require('node:assert/strict');
const { languageBaseUrl } = require('./language-url');
const config = { siteBaseUrl: 'https://example.com', localTestBaseUrl: 'http://example.c', useLanguageSubdomains: true };
const areas = [{ acode: 'cn', domain: 'cn.example.com', is_default: '1' }, { acode: 'en', domain: 'example.com', is_default: '0' }];
test('public domains take precedence over the local default language', () => {
  assert.equal(languageBaseUrl(config, 'cn', areas, true), 'https://cn.example.com');
  assert.equal(languageBaseUrl(config, 'en', areas, true), 'https://example.com');
  assert.equal(languageBaseUrl(config, 'cn', areas, false), 'http://example.c');
});
test('sites without domain mappings retain fallback and subdomains-disabled behavior', () => {
  assert.equal(languageBaseUrl(config, 'en', [], true), 'https://example.com');
  assert.equal(languageBaseUrl(config, 'es', [], true), 'https://es.example.com');
  assert.equal(languageBaseUrl({ ...config, useLanguageSubdomains: false }, 'cn', areas, true), 'https://example.com');
});
test('invalid/local domain mappings block submission instead of silently submitting wrong URLs', () => {
  for (const domain of ['example.c', 'https://user:pass@example.com', 'example.com/some-path', 'http://localhost']) {
    assert.throws(() => languageBaseUrl(config, 'cn', [{ acode: 'cn', domain }], true));
  }
});
