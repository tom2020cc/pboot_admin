import request, { API_BASE_URL } from "@/utils/request";

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

export const getUploadUrl = (filename: string) => {
  if (!filename) return "";
  const value = filename.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `${window.location.protocol}${value}`;
  if (/^\/?uploads?\//i.test(value)) {
    return value.startsWith("/") ? `${API_BASE_URL}${value}` : `${API_BASE_URL}/${value}`;
  }
  if (/^\/?static\//i.test(value)) {
    return `${API_BASE_URL}/pboot-static/${value.replace(/^\/?static\//i, "")}`;
  }
  if (value.startsWith("/")) {
    return `${API_BASE_URL}${value}`;
  }
  return `${API_BASE_URL}/uploads/${value}`;
};

export const decodeHtmlEntities = (html: string) => {
  if (!html) return "";
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
  return repairTranslatedHtml(html).replace(/(<img\b[^>]*\bsrc=)(["']?)([^"'\s>]+)\2([^>]*>)/gi, (match, prefix, quote, src, suffix) => {
    if (!src || /^https?:\/\//i.test(src) || /^data:/i.test(src)) return match;
    const nextQuote = quote || '"';
    return `${prefix}${nextQuote}${getUploadUrl(src)}${nextQuote}${suffix}`;
  });
};
