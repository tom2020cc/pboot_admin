const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('./server.js'), 'utf8');
const handler = source.slice(source.indexOf('async function startSeoPublication('), source.indexOf('function ensureIndexNowKeys('));
function setup(environment, overrides = {}) {
  const calls = [];
  const context = vm.createContext({
    URL, Date, process: { env: {} }, BACKEND_ENV_PATH: 'test', parseEnvFile: () => ({}),
    deploymentEnvironment: () => ({ environment }),
    generateFiles: async () => { calls.push('generate'); return { urlCount: 2 }; },
    inspectSite: async () => ({ siteRoot: '/sites/selected', config: {}, urls: [{ url: 'https://a.example/' }, { url: 'https://cn.a.example/' }] }),
    ensureIndexNowKeys: (config, root, hosts) => { assert.equal(root, '/sites/selected'); assert.deepEqual(Array.from(hosts), ['a.example', 'cn.a.example']); calls.push('keys'); return { keyFiles: [{}, {}] }; },
    publishLocalSite: async () => { calls.push('local'); },
    requestFtpTool: async (route, options) => { assert.equal(route, '/api/upload'); assert.equal(JSON.parse(options.body).scope, 'seo'); calls.push('ftp'); return { info: { browserUrl: 'ftp-tool' }, data: { state: { running: true } } }; },
    ...overrides,
  });
  vm.runInContext(handler, context);
  return { run: () => context.startSeoPublication(), calls };
}
test('BaoTa publishes to selected website and never starts FTP', async () => {
  const task = setup('baota');
  const result = await task.run();
  assert.deepEqual(task.calls, ['generate', 'keys']);
  assert.equal(result.mode, 'direct');
  assert.equal(result.started, false);
  assert.equal(result.state.published, 4);
  assert.equal(result.state.uploaded, 0);
});
test('local mode preserves FTP publication and polling state', async () => {
  const task = setup('local');
  const result = await task.run();
  assert.deepEqual(task.calls, ['local', 'ftp']);
  assert.equal(result.started, true);
  assert.equal(result.state.running, true);
});
test('direct write errors fail without falling back to FTP or reporting success', async () => {
  const task = setup('baota', { generateFiles: async () => { throw new Error('permission denied'); } });
  await assert.rejects(task.run(), /permission denied/);
  assert.deepEqual(task.calls, []);
});
