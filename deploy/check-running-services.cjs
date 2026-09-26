const fs = require('node:fs');

const webServices = {
  'pboot-admin-api': ['BACKEND_PORT', 5108, '/project-identity'],
  'pboot-seo-tool': ['SEO_TOOL_PORT', 5388, '/deployment-environment'],
  'pboot-ftp-tool': ['FTP_TOOL_PORT', 5389, '/deployment-environment'],
};

async function checkServices(apps, required, fetchImpl = fetch) {
  for (const name of required) {
    const app = apps.find(item => item.name === name);
    if (!app || app.pm2_env?.status !== 'online' || !Number(app.pid)) throw new Error(`${name} is not running`);
    const endpoint = webServices[name];
    if (!endpoint) continue;
    const port = Number(app.pm2_env[endpoint[0]] || endpoint[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} has an invalid port`);
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}${endpoint[2]}`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok || (await response.json()).environment !== 'baota') throw new Error('Unexpected response');
    } catch (_) {
      throw new Error(`${name} health check failed`);
    }
  }
}

if (require.main === module) {
  Promise.resolve().then(() => checkServices(JSON.parse(fs.readFileSync(0, 'utf8')), process.argv.slice(2)))
    .then(() => console.log('All deployed services healthy'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { checkServices };
