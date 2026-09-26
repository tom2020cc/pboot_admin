const test = require('node:test');
const assert = require('node:assert/strict');
const { runRemoteBuild, buildRemoteApplyScript } = require('./bt-panel');

function panelFixture(logs) {
  const actions = [];
  return {
    actions,
    async call(method, url, body) {
      const action = new URL('http://panel' + url).searchParams.get('action');
      actions.push({ action, form: Object.fromEntries(new URLSearchParams(body)) });
      const data = action === 'AddCrontab' ? { status: true, id: 7 }
        : action === 'GetLogs' ? logs.shift() : { status: true };
      return { status: 200, body: JSON.stringify(data) };
    },
  };
}
test('publish polls until explicit completion and removes only its own task', async () => {
  const panel = panelFixture(['PBOOT_BUILD_STARTED', 'PBOOT_BUILD_DONE\n']);
  await runRemoteBuild(panel, '/www/project', { sleep: async () => {} });
  assert.equal(panel.actions.filter(a => a.action === 'GetLogs').length, 2);
  assert.deepEqual(panel.actions.at(-1), { action: 'DelCrontab', form: { id: '7' } });
  assert.ok(panel.actions[0].form.sBody.includes("bash '/www/project/deploy/apply-project.sh'"));
});
test('build failure or timeout never reports success and always cleans its task', async () => {
  for (const logs of [['PBOOT_BUILD_FAILED line=5 exit=1'], ['Still building']]) {
    const panel = panelFixture(logs);
    await assert.rejects(runRemoteBuild(panel, '/www/project', { sleep: async () => {}, attempts: 1 }), /失败|超时/);
    assert.equal(panel.actions.at(-1).action, 'DelCrontab');
  }
});
test('manual entrypoint safely quotes server path and rejects traversal', () => {
  assert.equal(buildRemoteApplyScript({ serverRoot: "/www/a'b $(touch nope)" }), "bash '/www/a'\\''b $(touch nope)/deploy/apply-project.sh'");
  assert.throws(() => buildRemoteApplyScript({ serverRoot: '/www/../etc' }));
});
