(() => {
  const page = location.pathname.endsWith("models-config.html") ? "models-config" : "models";
  document.querySelectorAll("[data-workspace-page]").forEach((link) => {
    const active = link.dataset.workspacePage === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  fetch("/api/config")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
    .then((data) => {
      const navigation = data.navigation || [];
      const nav = document.getElementById("toolNav");
      if (!nav) return;
      nav.innerHTML = navigation.map((item) => {
        const active = item.id === page;
        return `<a class="${active ? "active" : ""}" href="${escapeHtml(item.url)}"${active ? ' aria-current="page"' : ""}>${escapeHtml(item.label)}</a>`;
      }).join("");
    })
    .catch(() => {});
})();
