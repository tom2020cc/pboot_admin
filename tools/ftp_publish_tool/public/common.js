(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function setStatus(text, isError = false) {
    $("status").textContent = text;
    $("status").className = isError ? "header-status error" : "header-status";
  }

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || "请求失败");
    return data;
  }

  function postJson(url, body = {}) {
    return api(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function renderNavigation(items, activeId) {
    $("toolNav").innerHTML = (items || []).map((item) => (
      `<a class="${item.id === activeId ? "active" : ""}" href="${escapeAttr(item.url || "#")}">${escapeHtml(item.label)}</a>`
    )).join("");
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  }

  function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("zh-CN", { hour12: false });
  }

  window.FtpTool = { $, api, escapeAttr, escapeHtml, formatBytes, formatDate, postJson, renderNavigation, setStatus };
}());
