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
