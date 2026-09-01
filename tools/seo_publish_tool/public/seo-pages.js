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
      description: "检查页面技术 SEO、内容完整度，并按语言筛选和修复问题。",
      badge: "检查与修复",
      documentTitle: "页面体检与优化 - PbootCMS",
    },
    engines: {
      title: "搜索引擎工作区",
      description: "选择一个搜索引擎，独立完成配置、主动提交和日常诊断。",
      badge: "选择引擎",
      documentTitle: "搜索引擎工作区 - PbootCMS",
    },
    google: {
      title: "Google 收录与主动推进",
      description: "管理 Search Console、Sitemap、URL Inspection 与 Indexing API 断点续传。",
      badge: "Google",
      documentTitle: "Google 收录 - PbootCMS",
    },
    bing: {
      title: "Bing 收录与主动提交",
      description: "管理 Bing Webmaster 验证、Sitemap、IndexNow 和 URL 查询。",
      badge: "Bing",
      documentTitle: "Bing 收录 - PbootCMS",
    },
    baidu: {
      title: "百度中文站收录",
      description: "配置百度搜索资源平台 token，并主动推送中文站 URL。",
      badge: "百度",
      documentTitle: "百度收录 - PbootCMS",
    },
    yandex: {
      title: "Yandex 收录与主动提交",
      description: "管理站点验证、OAuth、Sitemap、IndexNow 与索引数据。",
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
})();
