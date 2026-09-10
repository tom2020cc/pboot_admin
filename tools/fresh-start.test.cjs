const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const runtime = require('./site-runtime');

test('fresh installation serves tool pages without reading a missing site configuration', async (t) => {
  t.mock.method(runtime, 'currentSite', () => null);
  t.mock.method(runtime, 'readManagedSites', () => []);
  t.mock.method(runtime, 'runForRequest', (_req, _res, callback) => callback());
  t.mock.method(runtime, 'siteFile', () => { throw new Error('Unexpected site file access'); });
  const env = { SEO_TOOL_PORT: process.env.SEO_TOOL_PORT, FTP_TOOL_PORT: process.env.FTP_TOOL_PORT };
  process.env.SEO_TOOL_PORT = '0';
  process.env.FTP_TOOL_PORT = '0';
  t.after(() => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const tool of ['./seo_publish_tool/server', './ftp_publish_tool/server']) {
    const server = require(tool).startServer();
    try {
      await once(server, 'listening');
      const address = server.address();
      assert.equal(address.address, '127.0.0.1');
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /<html/i);
    } finally {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
