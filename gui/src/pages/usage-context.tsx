import { useCallback, useState } from "react";
import type { ContextPart, ContextSnapshot } from "../../../src/usage/context-inspector-types";
import { useDataSurface } from "../data-surface";
import { useI18n, type TKey } from "../i18n/shared";
import { formatTokens } from "../format-tokens";
import { Notice, Switch } from "../ui";
import "../styles-context-inspector.css";

const labels: Record<ContextPart, TKey> = {
  instructions: "context.instructions", tools: "context.tools", mcp: "context.mcp",
  files: "context.files", results: "context.results", conversation: "context.conversation",
};
const parts = Object.keys(labels) as ContextPart[];
function parseSnapshot(value: unknown): ContextSnapshot {
  const data = value as ContextSnapshot;
  if (!data || typeof data.enabled !== "boolean" || !Number.isFinite(data.expiresAt)
    || !Array.isArray(data.sessions) || data.sessions.length > 64
    || data.sessions.some(session => typeof session.id !== "string" || !/^[a-f0-9]{16}$/.test(session.id)
      || !Array.isArray(session.samples) || !session.samples.length || session.samples.length > 32
      || session.samples.some(sample => !sample || typeof sample.model !== "string"
        || !Number.isFinite(sample.at) || !Number.isFinite(sample.estimatedTokens)
        || !sample.parts || parts.some(part => !Number.isFinite(sample.parts[part]) || sample.parts[part] < 0)
        || !Array.isArray(sample.largest) || sample.largest.length > 8
        || sample.largest.some(item => !parts.includes(item.part) || !Number.isFinite(item.tokens) || !Number.isFinite(item.index))))) {
    throw new Error("invalid_context_snapshot");
  }
  return data;
}

export default function UsageContext({ apiBase }: { apiBase: string }) {
  const { t, locale } = useI18n();
  const tokens = (value: number) => formatTokens(value, locale);
  const [pending, setPending] = useState(false);
  const [acknowledged, setAcknowledged] = useState<ContextSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(`${apiBase}/api/context-inspector`, { signal });
    if (response.status === 404) { setUnavailable(true); return null; }
    if (!response.ok) throw new Error("context_read_failed");
    setUnavailable(false);
    const snapshot = parseSnapshot(await response.json());
    setAcknowledged(null);
    return snapshot;
  }, [apiBase]);
  const resource = useDataSurface<ContextSnapshot | null>(`${apiBase}/api/context-inspector`, [apiBase], load,
    { pollMs: 5000, isEmpty: () => false });
  const data = acknowledged ?? resource.state.data;
  async function toggle() {
    setPending(true); setFailed(false);
    try {
      const response = await fetch(`${apiBase}/api/context-inspector`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !data?.enabled }),
      });
      if (!response.ok) throw new Error("context_capture_failed");
      setAcknowledged(parseSnapshot(await response.json()));
      resource.refresh();
    } catch { setFailed(true); }
    finally { setPending(false); }
  }
  return <section className="context-inspector">
    <div className="context-capture">
      <div><h3>{t("context.capture")}</h3><p className="muted text-label">{t("context.captureHint")}</p></div>
      <Switch on={data?.enabled ?? false} disabled={pending || !data || unavailable}
        label={t("context.capture")} onClick={() => { void toggle(); }} />
    </div>
    {unavailable && <Notice tone="warn">{t("context.unavailable")}</Notice>}
    {(failed || resource.state.showError) && <Notice tone="err">{t("context.failed")}</Notice>}
    {!data?.sessions.length && <p className="muted context-empty">{t("context.empty")}</p>}
    {data?.sessions.map((session, index) => {
      const sample = session.samples.at(-1)!;
      const total = Math.max(1, sample.estimatedTokens);
      const peak = Math.max(1, ...session.samples.map(item => item.estimatedTokens));
      const trend = session.samples.map((item, i) => `${i * 100 / Math.max(1, session.samples.length - 1)},${30 - item.estimatedTokens * 28 / peak}`).join(" ");
      return <article key={session.id} className="context-session card">
        <div className="context-session-head">
          <div><strong>{sample.model || t("context.session", { n: index + 1 })}</strong>
            <p className="muted text-label">{t("context.session", { n: index + 1 })} · {new Date(sample.at).toLocaleTimeString()}</p></div>
          <div className="context-total"><strong className="mono">{tokens(sample.estimatedTokens)}</strong>
            <span className="muted text-label">{t("context.estimated")}</span></div>
        </div>
        {session.samples.length > 1 && <svg className="context-trend" viewBox="0 0 100 32" preserveAspectRatio="none"
          role="img" aria-label={t("context.samples", { n: session.samples.length })}>
          <polyline points={trend} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>}
        <div className="context-bar" role="img" aria-label={parts.map(part => `${t(labels[part])}: ${tokens(sample.parts[part])}`).join(", ")}>
          {parts.map(part => sample.parts[part] > 0 ? <span key={part} className={`context-part context-part-${part}`}
            style={{ flexGrow: sample.parts[part] / total }} /> : null)}
        </div>
        <dl className="context-legend">{parts.map(part => <div key={part}>
          <dt><span className={`context-dot context-part-${part}`} />{t(labels[part])}</dt>
          <dd className="mono">{tokens(sample.parts[part])}</dd>
        </div>)}</dl>
        <div className="context-facts text-label muted">
          {sample.delta !== undefined && <span>{t("context.change")} <b className="mono">{sample.delta > 0 ? "+" : ""}{tokens(sample.delta)}</b></span>}
          {sample.reportedTokens !== undefined && <span>{t("context.reported")} <b className="mono">{tokens(sample.reportedTokens)}</b></span>}
          {sample.cachedTokens !== undefined && <span>{t("context.cached")} <b className="mono">{tokens(sample.cachedTokens)}</b></span>}
          <span>{t("context.samples", { n: session.samples.length })}</span>
        </div>
        {(sample.truncated || sample.remoteHistory) && <p className="text-label muted">{t(sample.truncated ? "context.partial" : "context.remote")}</p>}
        <details><summary>{t("context.largest")}</summary>
          <ol className="context-largest">{sample.largest.map((item, i) => <li key={i}>
            <span>{t(labels[item.part])} <span className="muted">#{item.index}</span></span><span className="mono">{tokens(item.tokens)}</span>
          </li>)}</ol>
        </details>
      </article>;
    })}
  </section>;
}
