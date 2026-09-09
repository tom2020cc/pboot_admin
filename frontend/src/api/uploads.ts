import request, { API_BASE_URL } from "@/utils/request";

import { getActiveSiteId } from "@/utils/siteSelection";

export const MAX_IMAGE_UPLOAD_SIZE = 5 * 1024 * 1024;
export const MAX_IMAGE_UPLOAD_SIZE_TEXT = "5MB";

export const getImageUploadSizeError = (file: File) => {
  if (file.size <= MAX_IMAGE_UPLOAD_SIZE) return "";
  return `图片太大：${file.name} 已超过 ${MAX_IMAGE_UPLOAD_SIZE_TEXT}，请压缩后再上传`;
};

export const validateImageUploadFiles = (files: File[]) => {
  const oversized = files.find((file) => getImageUploadSizeError(file));
  return oversized ? getImageUploadSizeError(oversized) : "";
};

export const uploadImages = async (formData: FormData) => {
  return request<string[]>({
    method: "POST",
    url: "/img-upload/imgs",
    data: formData,
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const uploadImage = async (formData: FormData) => {
  return request<string>({
    method: "POST",
    url: "/img-upload/img",
    data: formData,
    headers: { "Content-Type": "multipart/form-data" },
  });
};

const decodePath = (value: string) => {
  try { return decodeURIComponent(value); } catch { return value; }
};

export const getUploadUrl = (filename: string) => {
  if (!filename) return "";
  const value = filename.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `${window.location.protocol}${value}`;
  if (/^\/?uploads?\//i.test(value)) {
    const filename = decodePath(value.replace(/^\/?uploads?\//i, ""));
    const siteId = getActiveSiteId();
    return `${API_BASE_URL}/img-upload/file/${encodeURIComponent(filename)}${siteId ? `?siteId=${siteId}` : ""}`;
  }
  if (/^\/?static\//i.test(value)) {
    const relativePath = decodePath(value.replace(/^\/?static\//i, ""));
    const siteId = getActiveSiteId();
    if (siteId) return `${API_BASE_URL}/sites/static-file?siteId=${siteId}&path=${encodeURIComponent(relativePath)}`;
    return `${API_BASE_URL}/pboot-static/${relativePath.split("/").map(encodeURIComponent).join("/")}`;
  }
  if (value.startsWith("/")) {
    return `${API_BASE_URL}${value}`;
  }
  const siteId = getActiveSiteId();
  return `${API_BASE_URL}/img-upload/file/${encodeURIComponent(value)}${siteId ? `?siteId=${siteId}` : ""}`;
};

export const decodeHtmlEntities = (html: string) => {
  if (!html) return "";
  // Decode an escaped document only; entities inside real HTML must stay escaped.
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(html)) return html;
  return html
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&");
};

export const repairTranslatedHtml = (html: string) => {
  if (!html) return "";
  return decodeHtmlEntities(html)
    .replace(/<\s*(\/?)\s*([a-z][a-z0-9:-]*)([^<>]*?)\s*>/gi, (_match, slash, tagName, rawAttrs) => {
      const name = String(tagName || "").toLowerCase();
      const attrs = repairTagAttributes(name, rawAttrs);

      if (slash) return `</${name}>`;
      return `<${name}${attrs ? ` ${attrs}` : ""}>`;
    })
    .replace(/<\s*br\s*\/\s*>/gi, "<br />")
    .replace(/<\s*img\b([^>]*)>\s*<\/\s*img\s*>/gi, "<img$1>");
};

const repairTagAttributes = (tagName: string, rawAttrs: string) => {
  let attrs = String(rawAttrs || "")
    .replace(/\s*=\s*/g, "=")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\/$/, " /")
    .trim();

  if (tagName === "img") {
    attrs = attrs
      .replace(/\bsrc=([^\s"'<>]+)/i, 'src="$1"')
      .replace(/\salt=([^\s"'<>][^<>]*?)(?=\s+[a-z:-]+=|\s*\/?$)/i, (_match, value) => {
        return ` alt="${escapeHtmlAttribute(String(value || "").trim())}"`;
      });
  }

  return attrs;
};

const escapeHtmlAttribute = (value: string) => {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

export const normalizeHtmlImageUrls = (html: string) => {
  if (!html) return "";
  const repaired = repairTranslatedHtml(html);
  if (typeof DOMParser === "undefined") {
    return repaired.replace(/(<img\b[^>]*\bsrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, prefix, doubleQuoted, singleQuoted, bare) => {
      const src = String(doubleQuoted ?? singleQuoted ?? bare ?? "").trim();
      if (!src || /^https?:\/\//i.test(src) || /^data:/i.test(src)) return match;
      return `${prefix}"${getUploadUrl(src)}"`;
    });
  }

  const document = new DOMParser().parseFromString(`<body>${repaired}</body>`, "text/html");
  document.body.querySelectorAll("img[src]").forEach((image) => {
    const src = String(image.getAttribute("src") || "").trim();
    if (!src || /^https?:\/\//i.test(src) || /^data:/i.test(src)) return;
    image.setAttribute("src", getUploadUrl(src));
  });
  return document.body.innerHTML;
};
