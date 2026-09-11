const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const deps = createRequire(path.join(root, 'backend/package.json'));
const { DataSource } = deps('typeorm');
const { isEmail } = deps('class-validator');
const { User } = require('../backend/dist/user/entities/user.entity');

async function createInitialAdmin({ location, email, credentialsPath }) {
  if (!isEmail(email) || !fs.existsSync(location)) throw new Error('Valid email and an existing database are required.');
  if (fs.existsSync(credentialsPath)) throw new Error('Initial credential file already exists; not overwriting it.');
  const db = new DataSource({ type: 'sqljs', location, autoSave: true, synchronize: false, entities: [User] });
  await db.initialize();
  try {
    const users = db.getRepository(User);
    if (await users.count()) throw new Error('Users already exist; refusing to create or replace an administrator.');
    const backup = `${credentialsPath}.database-backup`;
    fs.copyFileSync(location, backup, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(backup, 0o600);
    const password = crypto.randomBytes(24).toString('base64url');
    // Save the handoff before committing the account so an interrupted install remains recoverable.
    fs.writeFileSync(credentialsPath, JSON.stringify({ email, password }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await users.save(users.create({ email, password }));
  } finally {
    await db.destroy();
  }
}

async function requireBackendStopped(port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Stop the backend before editing its sql.js database.')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Could not verify backend state.')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
}

async function main() {
  if (root !== '/www/wwwroot/pboot_admin_center' || process.getuid?.() !== 0) throw new Error('Run from the server installation as root.');
  const env = deps('dotenv').parse(fs.readFileSync(path.join(root, 'backend/.env')));
  const location = path.join(root, 'data/pboot-admin.sqlite');
  if (env.DB_TYPE !== 'sqljs' || path.resolve(env.DB_SQLJS_LOCATION || '') !== location || fs.realpathSync(location) !== location) {
    throw new Error('Unexpected database location or driver.');
  }
  await requireBackendStopped(Number(env.BACKEND_PORT || 5108));
  await createInitialAdmin({ location, email: process.argv[2] || 'admin@pboot.local', credentialsPath: '/root/pboot-admin-initial-login.json' });
  console.log('Initial administrator created. Credentials: /root/pboot-admin-initial-login.json (root-only).');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { createInitialAdmin, requireBackendStopped };
