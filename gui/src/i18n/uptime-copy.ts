import type { LabLocale } from "./lab-translations";

// Compact units must work before a full language catalog has loaded.
const units: Record<LabLocale, readonly [string, string, string, string]> = {
  "en": ["d", "h", "m", "s"],
  "de": ["T", "Std", "Min", "Sek"],
  "fr": ["j", "h", "min", "s"],
  "ko": ["일", "시간", "분", "초"],
  "zh": ["天", "小时", "分钟", "秒"],
  "zh-TW": ["天", "小時", "分鐘", "秒"],
  "ru": ["д", "ч", "мин", "с"],
  "ja": ["日", "時間", "分", "秒"],
  "tr": [" gün", " saat", " dk", " sn"],
  "vi": ["ng", "g", "p", "g"],
  "pt": ["d", "h", "m", "s"],
};

export function uptimeCopy(locale: LabLocale) {
  const [day, hour, minute, second] = units[locale];
  return { "uptime.day": day, "uptime.hour": hour, "uptime.minute": minute, "uptime.second": second };
}
