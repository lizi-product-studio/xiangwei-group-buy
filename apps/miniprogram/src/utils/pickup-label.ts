const separators = /^[\s,，、;；:：|·\-—–()（）\u005B\u005D【】]+|[\s,，、;；:：|·\-—–()（）\u005B\u005D【】]+$/g;
const schoolPattern = /^(.*?)(?:第)?([0-9零〇一二三四五六七八九十百]+)(?:中学|中)$/;

function ordinal(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = "零一二三四五六七八九";
  if (value.length === 1) {
    const digit = digits.indexOf(value.replace("〇", "零"));
    return digit >= 0 ? digit : undefined;
  }
  // Deliberately limit aliases to ordinary school ordinals below 100.
  const match = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(value);
  return match ? (match[1] ? digits.indexOf(match[1]) : 1) * 10 + (match[2] ? digits.indexOf(match[2]) : 0) : undefined;
}

/** Only discard an administrative prefix when it consists entirely of named divisions.
 * A repeated province short name is accepted only when that province was explicit.
 */
function administrativePrefix(value: string): boolean {
  if (!value) return true;
  let remaining = value;
  let province = "";
  let count = 0;
  while (remaining) {
    const part = /^([\u4e00-\u9fff]{2,8}?)(省|市|县|区|镇|乡)/.exec(remaining);
    if (!part) break;
    if (part[2] === "省" && count === 0) province = part[1]!;
    remaining = remaining.slice(part[0].length);
    count += 1;
  }
  return count > 0 && (!remaining || remaining === province);
}

/** Display-only deduplication; never alters the stored address. Uncertain aliases stay visible. */
export function compactPickupAddress(name: string | null | undefined, address: string | null | undefined): string {
  const rawName = name?.trim();
  const rawAddress = address?.trim();
  if (!rawAddress) return "";
  if (!rawName) return rawAddress;
  const pointName = rawName.replace(/自提点$/, "").trim();
  if (!pointName) return rawAddress;
  if (rawAddress === rawName || rawAddress === pointName) return "";

  const school = schoolPattern.exec(pointName);
  if (school && school[1] && ordinal(school[2]!) !== undefined) {
    const candidate = /^(.*?)(?:第)?([0-9零〇一二三四五六七八九十百]+)(中学|中)(.*)$/.exec(rawAddress);
    if (!candidate || ordinal(candidate[2]!) !== ordinal(school[2]!)) return rawAddress;
    const locality = school[1]!;
    if (!candidate[1]!.endsWith(locality)) return rawAddress;
    const prefix = candidate[1]!.slice(0, -locality.length);
    if (!administrativePrefix(prefix)) return rawAddress;
    const detail = candidate[4]!.replace(separators, "");
    // Affiliated schools and named campuses may identify another pickup location.
    if (/^(?:附属|附小|附中|实验|分校|小学|幼儿园)/.test(detail)) return rawAddress;
    return detail;
  }

  // Non-school names retain the original exact-match behavior. Do not guess aliases.
  const at = rawAddress.indexOf(rawName);
  if (at < 0) return rawAddress;
  const before = rawAddress.slice(0, at).replace(separators, "");
  const after = rawAddress.slice(at + rawName.length).replace(separators, "");
  return `${before} ${after}`.trim().replace(/\s+/g, " ");
}
