import { resetAtToMs, type StoredAccountQuota } from "./quota-types";
import type { QuotaHistorySample } from "./quota-history";

export interface QuotaPaceReading {
  window: "weekly" | "monthly";
  usedPercent: number;
  resetAt: number;
  remainingPerHour: number;
}
const MAX_AGE_MS = 15 * 60_000;
const valid = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The percentage and deadline must describe the same current governing window. */
export function quotaPaceReading(quota: StoredAccountQuota | null, monthlyOnly: boolean, now = Date.now()): QuotaPaceReading | null {
  if (!quota || !valid(quota.updatedAt) || now < quota.updatedAt || now - quota.updatedAt > MAX_AGE_MS) return null;
  const window = monthlyOnly || (quota.weeklyPercent === undefined && quota.monthlyIsPrimaryWindow) ? "monthly" : "weekly";
  const usedPercent = window === "monthly" ? quota.monthlyPercent : quota.weeklyPercent;
  const reset = window === "monthly" ? quota.monthlyResetAt : quota.weeklyResetAt;
  if (!valid(usedPercent) || usedPercent < 0 || usedPercent > 100 || !valid(reset)) return null;
  const resetAt = resetAtToMs(reset);
  if (resetAt <= now) return null;
  return { window, usedPercent, resetAt, remainingPerHour: (100 - usedPercent) / Math.max(1, (resetAt - now) / 3_600_000) };
}

/** Informational recent rate; never routes from a forecast or joins different reset windows. */
export function quotaPaceTrend(observations: ReadonlyArray<Omit<QuotaHistorySample, "credentialGeneration">>, reading: QuotaPaceReading, now = Date.now()) {
  const points = observations.slice(-200).flatMap(sample => {
    if (!valid(sample?.observedAt) || sample.observedAt > now || !Array.isArray(sample.windows)) return [];
    const window = sample.windows.slice(0, 5).find(item => item && item.family === "account" && item.window === reading.window
      && valid(item.resetAtMs) && Math.abs(item.resetAtMs - reading.resetAt) < 1000);
    return window && valid(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100
      ? [{ at: sample.observedAt, used: window.usedPercent }] : [];
  }).sort((a, b) => a.at - b.at).slice(-64);
  const first = points[0];
  const last = points.at(-1);
  const trustworthy = points.length >= 3 && first && last && last.at - first.at >= 5 * 60_000
    && now - last.at <= MAX_AGE_MS && points.every((point, i) => i === 0 || point.used >= points[i - 1]!.used);
  const observedPerHour = trustworthy ? (last.used - first.used) / ((last.at - first.at) / 3_600_000) : null;
  const status = observedPerHour === null ? "unknown"
    : observedPerHour > reading.remainingPerHour * 1.25 ? "fast"
    : observedPerHour < reading.remainingPerHour * 0.75 ? "slow" : "balanced";
  return { points, observedPerHour, status } as const;
}
