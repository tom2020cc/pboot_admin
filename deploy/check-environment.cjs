const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireBackend = createRequire(path.join(__dirname, '../backend/package.json'));
const { parse } = requireBackend('dotenv');

function checkEnvironment({ root = path.resolve(__dirname, '..'), target, runtimeEnv = process.env, platform = process.platform, nodeVersion = process.versions.node } = {}) {
  if (!['local', 'baota'].includes(target)) throw new Error('Specify --target local or --target baota');
  const results = [];
  const check = (ok, name, hint) => results.push({ level: ok ? 'pass' : 'error', name, hint: ok ? '' : hint });
  const readEnv = relative => {
    const file = path.join(root, relative);
    return fs.existsSync(file) ? parse(fs.readFileSync(file)) : {};
  };
  const env = { ...readEnv('backend/.env'), ...runtimeEnv };
  const prod = target === 'baota';
  const [major, minor] = nodeVersion.split('.').map(Number);
  check(major > 22 || major === 22 && minor >= 12, 'Node version', 'The project requires Node >= 22.12.0.');
  check(fs.existsSync(path.join(root, 'backend/.env')), 'Backend environment file', 'Keep the target backend/.env; do not replace it with another environment.');
  check(env.APP_ENVIRONMENT === target, 'Environment label', `Set APP_ENVIRONMENT=${target} in the actual backend process.`);
  check(env.DB_TYPE === 'sqljs', 'Management database type', 'This deployment uses DB_TYPE=sqljs; a database-engine migration requires a separate plan.');
  check(['127.0.0.1', '::1', 'localhost'].includes(env.BACKEND_HOST), 'Backend listener', 'Bind the API to loopback; use Nginx for public access.');
  check(Number.isInteger(Number(env.BACKEND_PORT)) && Number(env.BACKEND_PORT) > 0 && Number(env.BACKEND_PORT) <= 65535, 'Backend port', 'Set a valid BACKEND_PORT.');
  const database = env.DB_SQLJS_LOCATION || '';
  const databasePath = path.resolve(root, 'backend', database);
  check(Boolean(database) && fs.existsSync(databasePath), 'Existing management database', 'Check DB_SQLJS_LOCATION and the backend working directory. Do not create or replace a production database to pass this check.');
  if (prod) {
    check(platform === 'linux', 'Target operating system', 'Run the BaoTa preflight on the Linux server.');
    check(env.NODE_ENV === 'production', 'Production mode', 'Set NODE_ENV=production in the actual PM2 environment.');
    check(database.startsWith('/') && !database.endsWith('/dev.sqlite'), 'Production database path', 'Use the existing absolute Linux management database path, not backend/dev.sqlite.');
    check(String(env.JWT_SECRET || '').length >= 32, 'Production JWT secret', 'Keep the server random JWT_SECRET (at least 32 characters); never publish it.');
    check(fs.existsSync(path.join(root, 'frontend/.env.production.local')), 'Production frontend configuration', 'Keep frontend/.env.production.local on the server.');
    check(!fs.existsSync(path.join(root, 'frontend/.env.local')), 'No local frontend override on server', 'Do not upload frontend/.env.local.');
  }
  const frontend = { ...readEnv('frontend/.env'), ...readEnv('frontend/.env.local'), ...readEnv(`frontend/.env.${prod ? 'production' : 'development'}`), ...readEnv(`frontend/.env.${prod ? 'production' : 'development'}.local`) };
  for (const [key, value] of Object.entries(runtimeEnv)) if (key.startsWith('VITE_')) frontend[key] = value;
  if (prod) {
    check(frontend.VITE_API_BASE_URL === '/api', 'Production frontend API', 'Set VITE_API_BASE_URL=/api before building; check shell overrides too.');
    for (const key of ['VITE_SEO_TOOL_URL', 'VITE_FTP_TOOL_URL']) check(isPublicHttps(frontend[key]), key, 'Use the production HTTPS tool origin, not localhost.');
    for (const key of ['ADMIN_PUBLIC_URL', 'SEO_PUBLIC_URL', 'FTP_PUBLIC_URL']) check(isPublicHttps(env[key]), key, 'Keep the production HTTPS management origin.');
  } else {
    let localApi = false;
    try { localApi = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(frontend.VITE_API_BASE_URL).hostname); } catch {}
    check(localApi, 'Local frontend API', 'Use the local management API; do not silently test against production.');
  }
  for (const key of ['BROCHURE_PDF_EXECUTABLE_PATH', 'QUOTATION_PDF_EXECUTABLE_PATH']) {
    if (env[key]) check(fs.existsSync(env[key]), key, 'Keep a browser executable path that exists on this machine.');
  }
  if (!env.BROCHURE_PDF_EXECUTABLE_PATH || !env.QUOTATION_PDF_EXECUTABLE_PATH) {
    let browserPresent = false;
    try { browserPresent = fs.existsSync(requireBackend('playwright').chromium.executablePath()); } catch {}
    check(browserPresent, 'Default PDF browser', 'Install Chromium for the actual service user or configure both PDF executable paths. Linux dependencies still require a real PDF export test.');
  }
  const sitesRoot = path.resolve(root, 'backend', env.MANAGED_SITES_DIR || '../managed-sites');
  check(fs.existsSync(sitesRoot), 'Managed-site configuration directory', 'Check MANAGED_SITES_DIR for this environment.');
  if (fs.existsSync(sitesRoot)) for (const directory of fs.readdirSync(sitesRoot, { withFileTypes: true })) {
    if (!directory.isDirectory() || directory.name.startsWith('_')) continue;
    const file = path.join(sitesRoot, directory.name, 'site.json');
    if (!fs.existsSync(file)) continue;
    try {
      const site = JSON.parse(fs.readFileSync(file, 'utf8')).site;
      if (site?.enabled === false) continue;
      const expected = prod ? 'baota' : 'phpstudy';
      check(site?.environment === expected, `Site environment (${directory.name})`, `Review this site's ${expected} binding in site management.`);
      check(Boolean(site?.rootPath) && fs.existsSync(site.rootPath), `Site root (${directory.name})`, 'The site root must exist on the target machine. This check never writes to PB.');
      check(Boolean(site?.dbPath) && fs.existsSync(site.dbPath), `PB database (${directory.name})`, 'The configured PB database must already exist; do not import local PB data as part of a code update.');
    } catch { check(false, `Site configuration (${directory.name})`, 'Check the site.json structure.'); }
  }
  results.push({level: 'info', name: 'Read-only scope', hint: 'No uploads, backups, database writes or PB changes. Passing does not verify Nginx, TLS, schema compatibility, write permissions, model providers or all PDF dependencies.'});
  return results;
}

function isPublicHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}
if (require.main === module) {
  try {
    const target = process.argv[process.argv.indexOf('--target') + 1];
    const results = checkEnvironment({ target });
    for (const result of results) console.log(`[${result.level.toUpperCase()}] ${result.name}${result.hint ? ': ' + result.hint : ''}`);
    process.exitCode = results.some(result => result.level === 'error') ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { checkEnvironment, isPublicHttps };
