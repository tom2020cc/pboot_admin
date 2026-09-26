(() => {
  const pages = {
    overview: {
      title: "SEO 总览",
      description: "集中查看搜索引擎就绪状态、收录入口和常用发布动作。",
      badge: "总览",
      documentTitle: "SEO 总览 - PbootCMS",
    },
    audit: {
      title: "页面体检与优化",
      description: "仅检查 CN 中文资料：检查 → 修改 → 查看页面效果。其他语言在中文完善后再翻译、同步。",
      badge: "仅 CN 中文版",
      documentTitle: "页面体检与优化 - PbootCMS",
    },
    engines: {
      title: "搜索引擎工作区",
      description: "选择一个搜索引擎，独立完成配置、主动提交和日常诊断。",
      badge: "选择引擎",
      documentTitle: "搜索引擎工作区 - PbootCMS",
    },
    google: {
      title: "Google 收录",
      description: "更新网站地图 → 提交给 Google → 等待并查看收录",
      badge: "Google",
      documentTitle: "Google 收录 - PbootCMS",
    },
    bing: {
      title: "Bing 收录与主动提交",
      description: "提交网站地图 → 主动通知更新 → 等待并查看收录",
      badge: "Bing",
      documentTitle: "Bing 收录 - PbootCMS",
    },
    baidu: {
      title: "百度中文站收录",
      description: "配置中文站 → 主动提交页面 → 等待并查看收录",
      badge: "百度",
      documentTitle: "百度收录 - PbootCMS",
    },
    yandex: {
      title: "Yandex 收录与主动提交",
      description: "俄语站：提交网站地图 → 主动通知更新 → 等待并查看收录",
      badge: "Yandex",
      documentTitle: "Yandex 收录 - PbootCMS",
    },
    settings: {
      title: "站点设置与配置迁移",
      description: "维护站点身份，并一键导出或导入搜索引擎、模型和 FTP 配置。",
      badge: "设置与备份",
      documentTitle: "站点设置与配置迁移 - PbootCMS",
    },
  };

  const page = document.documentElement.dataset.seoPage || "overview";
  const meta = pages[page] || pages.overview;
  const title = document.getElementById("workspaceTitle");
  const description = document.getElementById("workspaceDescription");
  const badge = document.getElementById("workspaceBadge");
  if (title) title.textContent = meta.title;
  if (description) description.textContent = meta.description;
  if (badge) badge.textContent = meta.badge;
  document.title = meta.documentTitle;

  document.querySelectorAll("[data-workspace-page]").forEach((link) => {
    const active = link.dataset.workspacePage === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
  });
  window.NavigationIcons?.decorateWorkspace();
  // Keep direct tutorial links usable when their containing panel is collapsed.
  function revealGoogleAnchor() {
    if (!["google", "bing", "baidu", "yandex"].includes(page) || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    for (let parent = target; parent; parent = parent.parentElement) {
      if (parent.tagName === "DETAILS") parent.open = true;
    }
    target.scrollIntoView({ block: "start" });
  }
  window.addEventListener("hashchange", revealGoogleAnchor);
  revealGoogleAnchor();
})();
