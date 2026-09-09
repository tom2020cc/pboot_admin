const languagePrefix = (lang: string) => lang === "zh-CN"
  ? "cn"
  : String(lang || "cn").toLowerCase().replace(/[^a-z0-9-]/g, "") || "cn";

const normalizeSlug = (value: string) => String(value || "")
  .trim()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/^https?:\/\/[^/]+/i, "")
  .replace(/[?#].*$/, "")
  .replace(/^\/+|\/+$/g, "")
  .replace(/\.(?:html?|php)$/i, "")
  .replace(/^(?:cn|en|es|fr|ru|ar|pt|id|tr|vi)[-_/]+/i, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 64);

export const buildLanguageUrlName = (lang: string, ...candidates: Array<string | number | undefined>) => {
  const prefix = languagePrefix(lang);
  const slug = candidates
    .map((candidate) => normalizeSlug(String(candidate || "")))
    .find(Boolean) || "content";
  return `${prefix}-${slug}`;
};

export const ensureLanguageUrlName = (
  lang: string,
  currentUrlName: string | undefined,
  ...candidates: Array<string | number | undefined>
) => {
  const prefix = languagePrefix(lang);
  const current = String(currentUrlName || "").trim().replace(/^\/+/, "");
  if (new RegExp(`^${prefix}[-_/]+`, "i").test(current)) return current;
  return buildLanguageUrlName(lang, ...candidates, current);
};
