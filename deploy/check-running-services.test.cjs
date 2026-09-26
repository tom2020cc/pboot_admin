const test = require('node:test');
const assert = require('node:assert/strict');
const { checkServices } = require('./check-running-services.cjs');
const names = ['pboot-admin-api', 'pboot-seo-tool', 'pboot-ftp-tool', 'pboot-seo-content-worker'];
const apps = () => names.map(name => ({ name, pid: 12, pm2_env: { status: 'online' } }));
const healthy = async () => ({ ok: true, json: async () => ({ environment: 'baota' }) });

test('checks each registered web service and the worker, not only the API', async () => {
  const urls = [];
  await checkServices(apps(), names, async url => { urls.push(url); return healthy(); });
  assert.deepEqual(urls, ['http://127.0.0.1:5108/project-identity', 'http://127.0.0.1:5388/deployment-environment', 'http://127.0.0.1:5389/deployment-environment']);
});
test('a missing or restarting tool prevents deployment success', async () => {
  const list = apps(); list[1].pm2_env.status = 'waiting restart';
  await assert.rejects(checkServices(list, names, healthy), /pboot-seo-tool is not running/);
  await assert.rejects(checkServices(apps().slice(0, 3), names, healthy), /pboot-seo-content-worker/);
});
test('rejects unreachable tools, wrong environments and HTTP failures', async () => {
  for (const bad of [async () => { throw new Error('Connection closed'); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => ({ environment: 'local' }) })]) {
    await assert.rejects(checkServices(apps(), names, async url => url.includes(':5388/') ? bad() : healthy()), /pboot-seo-tool health check failed/);
  }
});
