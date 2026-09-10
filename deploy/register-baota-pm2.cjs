// Register existing processes in the legacy BaoTa PM2 plugin without restarting them.
const fs = require('node:fs');
const path = require('node:path');
const { apps } = require('./baota.ecosystem.config');
const root = path.resolve(__dirname, '..');
const plugin = '/www/server/panel/plugin/pm2';
if (root !== '/www/wwwroot/pboot_admin_center' || !fs.existsSync(path.join(plugin, 'pm2_main.py'))) {
  throw new Error('Run only in the fresh BaoTa installation with the PM2 plugin installed.');
}
const directory = path.join(plugin, 'list');
fs.mkdirSync(directory, { recursive: true });
for (const app of apps) {
  const file = path.join(directory, `${app.name}.json`);
  if (fs.existsSync(file)) {
    console.log(`Existing registration preserved: ${app.name}`);
    continue;
  }
  const memory = parseInt(app.max_memory_restart, 10) * (app.max_memory_restart.endsWith('G') ? 1024 : 1);
  const port = { 'pboot-admin-api': 5108, 'pboot-seo-tool': 5388, 'pboot-ftp-tool': 5389 }[app.name];
  const metadata = {
    pname: app.name, exec_user: 'root', cluster: 1, max_memory: memory,
    path: app.cwd, run: path.resolve(app.cwd, app.script), ...(port ? { port } : {}),
  };
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Registered: ${app.name}`);
}
