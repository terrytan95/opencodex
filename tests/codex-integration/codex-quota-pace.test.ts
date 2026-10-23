import { expect, test } from "bun:test";
import { quotaPaceReading, quotaPaceTrend } from "../../src/codex/quota-pace";

const now = 1_800_000_000_000;
test("pace uses the governing window with bounded reset urgency and fresh evidence", () => {
  const q = { updatedAt: now, weeklyPercent: 50, weeklyResetAt: (now + 2 * 3600_000) / 1000,
    monthlyPercent: 20, monthlyResetAt: now + 20 * 3600_000 };
  expect(quotaPaceReading(q, false, now)?.remainingPerHour).toBe(25);
  expect(quotaPaceReading(q, true, now)?.remainingPerHour).toBe(4);
  expect(quotaPaceReading({ ...q, weeklyResetAt: now + 1 }, false, now)?.remainingPerHour).toBe(50);
  expect(quotaPaceReading({ ...q, weeklyPercent: undefined, monthlyIsPrimaryWindow: true }, false, now)?.window).toBe("monthly");
  for (const invalid of [{ updatedAt: now - 16 * 60_000 }, { updatedAt: now + 1 }, { weeklyResetAt: now },
    { weeklyPercent: NaN }, { weeklyPercent: -1 }, { weeklyPercent: undefined }]) {
    expect(quotaPaceReading({ ...q, ...invalid }, false, now)).toBeNull();
  }
});

test("trend never joins reset windows or treats sparse, stale or falling data as a rate", () => {
  const resetAt = now + 3600_000;
  const reading = { window: "weekly" as const, usedPercent: 50, resetAt, remainingPerHour: 50 };
  const rows = [10, 30, 50].map((usedPercent, i) => ({ observedAt: now - (2 - i) * 5 * 60_000,
    source: "wham" as const, windows: [{ family: "account" as const, window: "weekly" as const, usedPercent, resetAtMs: resetAt }] }));
  expect(quotaPaceTrend(rows, reading, now).status).toBe("fast");
  expect(quotaPaceTrend(rows.slice(1), reading, now).status).toBe("unknown");
  expect(quotaPaceTrend(rows, { ...reading, resetAt: resetAt + 10000 }, now).points).toEqual([]);
  expect(quotaPaceTrend(rows, reading, now + 16 * 60_000).status).toBe("unknown");
  rows[2]!.windows[0]!.usedPercent = 20;
  expect(quotaPaceTrend(rows, reading, now).status).toBe("unknown");
});
