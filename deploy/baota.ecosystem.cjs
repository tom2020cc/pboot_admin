const path = require('node:path');
const root = path.resolve(__dirname, '..');
const applications = [
  ['pboot-admin-api', 'backend', 'dist/main.js', '1G'],
  ['pboot-seo-tool', 'tools/seo_publish_tool', 'server.js', '768M'],
  ['pboot-ftp-tool', 'tools/ftp_publish_tool', 'server.js', '512M'],
  ['pboot-seo-content-worker', '.', 'tools/seo-content-worker/index.cjs', '400M'],
];
module.exports = { apps: applications.map(([name, directory, script, memory]) => ({
  name, cwd: path.join(root, directory), script,
  instances: 1, exec_mode: 'fork', interpreter: process.execPath,
  env: {
    NODE_ENV: 'production', BACKEND_HOST: '127.0.0.1', BACKEND_PORT: '5108',
    SEO_TOOL_HOST: '127.0.0.1', SEO_TOOL_PORT: '5388', FTP_TOOL_PORT: '5389',
  },
  autorestart: true, restart_delay: 10000, kill_timeout: 20000,
  max_memory_restart: memory, time: true,
})) };
