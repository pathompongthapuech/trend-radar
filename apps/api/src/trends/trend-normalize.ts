export type NormalizeOptions = {
  ensureHashPrefix?: boolean;
  trim?: boolean;
  collapseSpaces?: boolean;
  unicodeForm?: "NFC" | "NFD" | "NFKC" | "NFKD";
};

export function softNormalizeKey(raw: string, opt: NormalizeOptions = {}) {
  const {
    ensureHashPrefix = true,
    trim = true,
    collapseSpaces = true,
    unicodeForm = "NFKC",
  } = opt;

  let s = raw ?? "";
  if (trim) s = s.trim();
  if (unicodeForm) s = s.normalize(unicodeForm);
  if (collapseSpaces) s = s.replace(/\s+/g, " ");
  // NOTE: ไม่ทำ lowercase/uppercase เพื่อไม่พังภาษา/แฮชแท็ก
  if (ensureHashPrefix && s && !s.startsWith("#")) s = `#${s}`;
  return s;
}
