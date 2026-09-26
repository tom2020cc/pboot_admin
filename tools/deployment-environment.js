const labels = { local: '本地调试', baota: '宝塔线上', unknown: '环境未确认' };

function deploymentEnvironment(env = process.env) {
  const requested = String(env.APP_ENVIRONMENT || '').trim().toLowerCase();
  const environment = ['local', 'baota'].includes(requested) ? requested : 'unknown';
  return { environment, label: labels[environment] };
}

module.exports = { deploymentEnvironment };
