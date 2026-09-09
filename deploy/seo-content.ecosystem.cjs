const path = require('node:path');
module.exports = { apps: [{ name: 'pboot-seo-content-worker',
  cwd: path.resolve(__dirname, '..'), script: 'tools/seo-content-worker/index.cjs',
  instances: 1, exec_mode: 'fork', autorestart: true, restart_delay: 10000,
  kill_timeout: 20000, max_memory_restart: '400M', time: true,
}] };
