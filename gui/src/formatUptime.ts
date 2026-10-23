import type { Locale } from "./i18n/catalogs";
import { uptimeCopy } from "./i18n/uptime-copy";

export function formatUptime(seconds: number, locale: Locale): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const { "uptime.day": day, "uptime.hour": hour, "uptime.minute": minute, "uptime.second": second } = uptimeCopy(locale);

  if (totalSeconds < 5 * 60) return `${totalSeconds}${second}`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}${minute}`;

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${totalHours}${hour} ${minutes}${minute}` : `${totalHours}${hour}`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours > 0 ? `${days}${day} ${hours}${hour}` : `${days}${day}`;
}
