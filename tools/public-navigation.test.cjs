const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicNavigation } = require('./public-navigation');
const ports = { frontendPort: 5278, backendPort: 5108, seoPort: 5388, ftpPort: 5389 };

test('local navigation keeps configured ports and document links', () => {
  const items = buildPublicNavigation({}, ports, 'ftp');
  assert.equal(items.find(item => item.id === 'seo').url, 'http://localhost:5388/');
  assert.equal(items.find(item => item.id === 'backend').url, 'http://localhost:5108/api-docs');
  assert.equal(items.find(item => item.id === 'brochure').url, 'http://localhost:5278/#/brochures');
  const ftp = items.find(item => item.id === 'ftp');
  assert.equal(ftp.label, 'FTP 工具');
  assert.equal(ftp.url, 'http://localhost:5389/');
  const baotaSync = items.find(item => item.id === 'baota-sync');
  assert.equal(baotaSync.label, '宝塔同步');
  assert.equal(baotaSync.url, 'http://localhost:5389/sync.html');
  assert.ok(!items.some(item => item.id === 'ftp-security'), 'ftp-security 不应出现在顶部导航');
});

test('baota environment hides baota-sync but keeps a single FTP tool entry', () => {
  const items = buildPublicNavigation({ APP_ENVIRONMENT: 'baota' }, ports, 'ftp');
  const ftp = items.find(item => item.id === 'ftp');
  assert.equal(ftp.label, 'FTP 工具');
  assert.equal(ftp.url, 'http://localhost:5389/');
  assert.ok(!items.some(item => item.id === 'ftp-security'));
  assert.ok(!items.some(item => item.id === 'baota-sync'));
});

test('independent production domains preserve site context without localhost or Swagger', () => {
  const env = { NODE_ENV: 'production', ADMIN_PUBLIC_URL: 'https://admin.example.com',
    SEO_PUBLIC_URL: 'https://seo.example.com', FTP_PUBLIC_URL: 'https://ftp.example.com' };
  const items = buildPublicNavigation(env, ports, 'seo', value => {
    const url = new URL(value); url.searchParams.set('siteId', '42'); return url.toString();
  });
  assert.ok(!items.some(item => item.id === 'backend'));
  assert.ok(items.every(item => item.url.startsWith('https://') && !item.url.includes('localhost')));
  assert.equal(items.find(item => item.id === 'sites').url, 'https://admin.example.com/?siteId=42#/sites');
  assert.equal(items.find(item => item.id === 'models').url, 'https://seo.example.com/models.html?siteId=42');
  assert.equal(items.find(item => item.id === 'seo').active, true);
});

test('public URL validation and optional docs prefix', () => {
  for (const value of ['javascript:alert(1)', 'https://user:secret@example.com']) {
    assert.throws(() => buildPublicNavigation({ SEO_PUBLIC_URL: value }, ports, 'seo'));
  }
  const items = buildPublicNavigation({ NODE_ENV: 'production', ENABLE_SWAGGER: 'true',
    BACKEND_PUBLIC_URL: 'https://admin.example.com/api' }, ports, 'seo');
  assert.equal(items.find(item => item.id === 'backend').url, 'https://admin.example.com/api/api-docs');
});
