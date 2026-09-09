const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const deps = createRequire(path.join(root, 'backend/package.json'));
const file = path.join(root, 'backend/.env');
const original = fs.readFileSync(file, 'utf8');
const config = deps('dotenv').parse(original);
if (config.SEO_WORKER_TOKEN && config.SEO_WORKER_TOKEN.length >= 32) console.log('Worker credential already configured; unchanged.');
else {
  const token = randomBytes(32).toString('hex');
  const updated = original.replace(/^SEO_WORKER_TOKEN=.*(?:\r?\n|$)/gm, '') + `\nSEO_WORKER_TOKEN=${token}\n`;
  fs.writeFileSync(file, updated, { mode: 0o600 });
  console.log('Worker credential generated locally. Restart the backend before starting the worker.');
}
