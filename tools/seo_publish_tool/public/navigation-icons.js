(() => {
  const icons = {
    admin: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    backend: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
    sites: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    quotation: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    seo: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11l2 2 4-4"/>',
    models: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M19 9h4M1 15h4M19 15h4"/>',
    'models-config': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    ftp: '<path d="M12 13V3M8 7l4-4 4 4"/><path d="M20 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/>',
    'ftp-security': '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3z"/><path d="m9 12 2 2 4-4"/>',
    overview: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/>',
    audit: '<path d="M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3"/><rect width="6" height="4" x="9" y="2" rx="1"/><path d="m9 14 2 2 4-4"/>',
    google: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3M8 11h6"/>',
    bing: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    baidu: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="11" cy="11" r="4"/><path d="m14 14 3 3"/>',
    yandex: '<path d="M5 8l6 8M4 16l6-8M14 8h6M17 8v8M14 16h6"/>',
    settings: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3 1.1 0 2.1-.1 3-.2M18 16v6M15 19h6"/>',
  };

  function icon(id) {
    const body = icons[id] || icons.overview;
    return `<svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
  }

  function decorateWorkspace(root = document) {
    root.querySelectorAll("[data-workspace-page]").forEach((link) => {
      if (!link.querySelector(".nav-icon")) {
        link.insertAdjacentHTML("afterbegin", icon(link.dataset.workspacePage));
      }
    });
  }

  window.NavigationIcons = { decorateWorkspace, icon };
})();
