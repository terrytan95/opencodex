import { useCallback, useState } from "react";
import { quotaPaceReading, quotaPaceTrend } from "../../../src/codex/quota-pace";
import type { QuotaHistorySample } from "../../../src/codex/quota-history";
import { isThirtyDayOnlyPlan, type AccountQuota } from "../codex-quota-utils";
import { useDataSurface } from "../data-surface";
import { useT } from "../i18n/shared";

export default function CodexQuotaPace({ apiBase, accountId, quota, plan }: {
  apiBase: string; accountId: string; quota: AccountQuota | null; plan?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`${apiBase}/api/codex-auth/quota/history?accountId=${encodeURIComponent(accountId)}&limit=64`, { signal });
    if (!response.ok) throw new Error("quota_history_unavailable");
    const body = await response.json() as { observations?: Array<Omit<QuotaHistorySample, "credentialGeneration">> };
    if (!Array.isArray(body.observations)) throw new Error("invalid_quota_history");
    return body.observations.slice(-64);
  }, [apiBase, accountId]);
  const resource = useDataSurface(`${apiBase}/api/codex-auth/quota/history/${accountId}`, [apiBase, accountId], load,
    { enabled: open, isEmpty: data => data.length === 0 });
  const reading = quotaPaceReading(quota, isThirtyDayOnlyPlan(plan));
  const trend = reading ? quotaPaceTrend(resource.state.data ?? [], reading) : null;
  const points = trend?.points ?? [];
  const first = points[0]?.at ?? 0;
  const span = Math.max(1, (points.at(-1)?.at ?? first) - first);
  return <details className="card-sub" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="text-label" style={{ cursor: "pointer", padding: "var(--space-2) 0" }}>{t("pace.title")}</summary>
    {open && <div style={{ padding: "var(--space-2) 0" }}>
      {reading && <p className="text-label mono">{t("pace.remaining", { rate: reading.remainingPerHour.toFixed(1) })}</p>}
      {points.length > 1 && <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img"
        aria-label={t("pace.samples", { n: points.length })} style={{ width: "100%", height: 56, color: "var(--green)" }}>
        <polyline points={points.map(point => `${(point.at - first) / span * 100},${39 - point.used * .38}`).join(" ")}
          fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>}
      <p className="muted text-label" role="status">{resource.state.showError ? t("pace.failed")
        : resource.state.showSkeleton ? t("common.loading") : t(`pace.${trend?.status ?? "unknown"}`)}</p>
    </div>}
  </details>;
}
