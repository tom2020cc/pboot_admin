const fs = require('node:fs');
const path = require('node:path');

function normalizeOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS origin without credentials, paths, query strings or fragments.');
  }
  return url.origin;
}

function updateEnv(text, values) {
  const remaining = new Map(Object.entries(values));
  const seen = new Set();
  const lines = text.split(/\r?\n/).filter(line => {
    const key = line.match(/^\s*([^#=\s]+)\s*=/)?.[1];
    if (!Object.hasOwn(values, key)) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(line => {
    const key = line.match(/^\s*([^#=\s]+)\s*=/)?.[1];
    if (!remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  for (const [key, value] of remaining) lines.push(`${key}=${value}`);
  return `${lines.join('\n')}\n`;
}

function configure(root, origins) {
  const [admin, seo, ftp] = origins.map(normalizeOrigin);
  if (!admin || !seo || !ftp) throw new Error('Three public origins are required.');
  const files = [
    ['backend/.env', { ADMIN_PUBLIC_URL: admin, SEO_PUBLIC_URL: seo, FTP_PUBLIC_URL: ftp }],
    ['frontend/.env.production.local', { VITE_API_BASE_URL: '/api', VITE_SEO_TOOL_URL: seo, VITE_FTP_TOOL_URL: ftp,
      VITE_ENABLE_SWAGGER: 'false' }],
  ];
  // Prepare both files before writing; leave unrelated secrets and settings intact.
  const updates = files.map(([relative, values]) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) throw new Error(`Initialize the deployment environment first: ${relative}`);
    return { file, text: updateEnv(fs.readFileSync(file, 'utf8'), values) };
  });
  for (const { file, text } of updates) {
    if (!fs.existsSync(`${file}.before-public-urls`)) fs.copyFileSync(file, `${file}.before-public-urls`, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(`${file}.before-public-urls`, 0o600);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, text, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
}

if (require.main === module) {
  configure(path.resolve(__dirname, '..'), process.argv.slice(2));
  console.log('Public origins configured. Rebuild the frontend and restart the two tool processes.');
}
module.exports = { normalizeOrigin, updateEnv, configure };
