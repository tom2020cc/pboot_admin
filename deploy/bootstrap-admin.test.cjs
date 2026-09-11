const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const deps = createRequire(path.resolve(__dirname, '../backend/package.json'));
const { DataSource } = deps('typeorm');
const { User } = require('../backend/dist/user/entities/user.entity');
const { createInitialAdmin, requireBackendStopped } = require('./bootstrap-admin.cjs');

test('initial administrator is hashed, privately handed off, and cannot replace existing users', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pboot-bootstrap-'));
  const location = path.join(directory, 'test.sqlite');
  const credentialsPath = path.join(directory, 'login.json');
  const options = { type: 'sqljs', location, autoSave: true, synchronize: true, entities: [User] };
  const empty = await new DataSource(options).initialize();
  await empty.destroy();
  await createInitialAdmin({ location, credentialsPath, email: 'admin@example.invalid' });
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
  const db = await new DataSource({ ...options, synchronize: false }).initialize();
  try {
    const [user] = await db.getRepository(User).find();
    assert.equal(user.email, credentials.email);
    assert.notEqual(user.password, credentials.password);
    assert.equal(deps('bcryptjs').compareSync(credentials.password, user.password), true);
    assert.ok(credentials.password.length >= 32);
    await assert.rejects(createInitialAdmin({ location, credentialsPath: path.join(directory, 'second.json'), email: 'another@example.invalid' }), /Users already exist/);
    assert.equal(fs.existsSync(path.join(directory, 'second.json')), false);
  } finally {
    await db.destroy();
    fs.rmSync(directory, { recursive: true });
  }
});

test('bootstrap refuses to write while the API port is listening', async () => {
  const server = net.createServer(socket => socket.end()).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(requireBackendStopped(server.address().port), /Stop the backend/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
