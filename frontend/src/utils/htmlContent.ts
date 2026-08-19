export const compactHtmlForStorage = (value = "") => {
  return value
    .trim()
    .replace(/\r\n?/g, "\n")
    .replace(/>\s+</g, "><")
    .replace(/\n+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
};
