const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deploymentEnvironment } = require('./deployment-environment');

test('only explicit deployment configuration determines the environment', () => {
  assert.equal(deploymentEnvironment({ APP_ENVIRONMENT: 'local' }).environment, 'local');
  assert.equal(deploymentEnvironment({ APP_ENVIRONMENT: ' baota ' }).environment, 'baota');
  for (const env of [{}, { NODE_ENV: 'production' }, { APP_ENVIRONMENT: 'invalid' }]) {
    assert.equal(deploymentEnvironment(env).environment, 'unknown');
  }
});

test('public environment data never exposes paths, tokens or credentials', () => {
  const result = deploymentEnvironment({ APP_ENVIRONMENT: 'local', JWT_SECRET: 'private', DB_SQLJS_LOCATION: '/private/database' });
  assert.deepEqual(Object.keys(result), ['environment', 'label']);
  assert.ok(!JSON.stringify(result).includes('private'));
});
