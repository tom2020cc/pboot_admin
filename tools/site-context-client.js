(() => {
  const siteId = new URLSearchParams(window.location.search).get("siteId");
  if (!siteId || !/^\d+$/.test(siteId)) return;

  window.__PBOOT_SITE_ID__ = Number(siteId);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const sourceRequest = input instanceof Request ? input : null;
    const requestUrl = new URL(sourceRequest ? sourceRequest.url : String(input), window.location.href);
    if (requestUrl.origin !== window.location.origin || !requestUrl.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }

    requestUrl.searchParams.set("siteId", siteId);
    const headers = new Headers(sourceRequest ? sourceRequest.headers : init.headers);
    headers.set("X-Pboot-Site-Id", siteId);
    if (sourceRequest) {
      return originalFetch(new Request(requestUrl, sourceRequest), { ...init, headers });
    }
    return originalFetch(requestUrl, { ...init, headers });
  };
})();

(() => {
  // 运行环境徽章：行内融入各页头部，不再单独占一行
  const ENV_STYLES = {
    local: { label: '本地调试', bg: '#e8f6f3', fg: '#126653', line: '#b7e4da', dot: '#14856b' },
    baota: { label: '宝塔线上', bg: '#fff0ef', fg: '#a32d32', line: '#f3c6c3', dot: '#c94646' },
    unknown: { label: '环境未确认', bg: '#fef3d8', fg: '#785219', line: '#efd7a1', dot: '#d9a53c' },
  };

  function createBadge() {
    const style = ENV_STYLES.unknown;
    const badge = document.createElement('span');
    badge.id = 'deployment-environment';
    badge.setAttribute('role', 'status');
    badge.setAttribute('aria-label', '当前运行环境');
    badge.title = `接口：${location.host}`;
    badge.style.cssText = `display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;height:24px;padding:0 10px;border-radius:999px;border:1px solid ${style.line};background:${style.bg};color:${style.fg};font:600 12px/1 system-ui,sans-serif;white-space:nowrap;cursor:default;`;
    const dot = document.createElement('span');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${style.dot};box-shadow:0 0 0 3px ${style.bg};`;
    const label = document.createElement('span');
    label.textContent = style.label;
    badge.append(dot, label);
    badge._dot = dot;
    badge._label = label;
    return badge;
  }

  function applyEnvironment(badge, environment) {
    const style = ENV_STYLES[environment] || ENV_STYLES.unknown;
    badge.style.borderColor = style.line;
    badge.style.background = style.bg;
    badge.style.color = style.fg;
    badge._dot.style.background = style.dot;
    badge._dot.style.boxShadow = `0 0 0 3px ${style.bg}`;
    badge._label.textContent = style.label;
  }

  function mountBadge(badge) {
    // 依次尝试各工具页面的头部容器；插到状态元素之前，融进头部一行
    const header = document.querySelector('.app-header') || document.querySelector('.seo-header') || document.querySelector('.topbar-inner');
    if (header) {
      const statusHost = header.querySelector('.header-status, .status-panel, #status');
      if (statusHost && statusHost.parentElement === header) header.insertBefore(badge, statusHost);
      else header.appendChild(badge);
      return;
    }
    // 兜底：右上角悬浮小胶囊
    badge.style.cssText += 'position:fixed;top:10px;right:14px;z-index:60;box-shadow:0 1px 4px rgba(20,27,38,.18);';
    document.body.appendChild(badge);
  }

  async function showEnvironment() {
    const badge = createBadge();
    mountBadge(badge);
    try {
      const response = await fetch('/deployment-environment', { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('environment unavailable');
      const data = await response.json();
      const environment = ['local', 'baota'].includes(data.environment) ? data.environment : 'unknown';
      applyEnvironment(badge, environment);
      document.title = `[${ENV_STYLES[environment].label}] ${document.title}`;
    } catch {
      applyEnvironment(badge, 'unknown');
      document.title = `[环境未确认] ${document.title}`;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showEnvironment, { once: true });
  else showEnvironment();
})();
