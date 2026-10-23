import { useCallback, useMemo, useState } from "react";
import type { AssetInventory } from "../../../../src/integrations/asset-inventory-types";
import { useDataSurface } from "../../data-surface";
import { useT } from "../../i18n/shared";
import { Notice } from "../../ui";
import "../../styles-asset-inventory.css";

export default function AssetInventoryPage({ apiBase, active }: { apiBase: string; active: boolean }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "skill" | "mcp">("all");
  const [issuesOnly, setIssuesOnly] = useState(false);
  const load = useCallback(async (signal: AbortSignal): Promise<AssetInventory> => {
    const response = await fetch(`${apiBase}/api/asset-inventory`, { signal });
    if (!response.ok) throw new Error("inventory_unavailable");
    const data = await response.json();
    if (!data || !Number.isFinite(data.generatedAt) || !Array.isArray(data.entries) || data.entries.length > 512
      || !Array.isArray(data.sources) || data.sources.length > 24
      || data.sources.some((source: AssetInventory["sources"][number]) => !source || typeof source.path !== "string" || typeof source.client !== "string" || !["skill", "mcp"].includes(source.kind) || !["read", "missing", "unavailable"].includes(source.status))
      || data.entries.some((entry: AssetInventory["entries"][number]) => !entry || !["skill", "mcp"].includes(entry.kind)
        || !["present", "linked", "broken", "unavailable"].includes(entry.status) || typeof entry.name !== "string"
        || entry.version !== undefined && typeof entry.version !== "string" || entry.transport !== undefined && typeof entry.transport !== "string"
        || !Array.isArray(entry.clients) || entry.clients.some(value => typeof value !== "string")
        || !Array.isArray(entry.sources) || entry.sources.some(value => typeof value !== "string"))) throw new Error("invalid_inventory");
    return data;
  }, [apiBase]);
  const resource = useDataSurface(`${apiBase}/api/asset-inventory`, [apiBase], load, { enabled: active, isEmpty: data => !data.entries.length });
  const data = resource.state.data;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.entries ?? []).filter(entry => (kind === "all" || entry.kind === kind)
      && (!issuesOnly || entry.duplicate || entry.status === "broken" || entry.status === "unavailable")
      && (!needle || [entry.name, ...entry.clients, ...entry.sources].some(value => value.toLowerCase().includes(needle))));
  }, [data, query, kind, issuesOnly]);
  return <section className="asset-inventory">
    <div className="asset-inventory-head"><div><h3>{t("inventory.title")}</h3><p className="muted text-label">{t("inventory.scope")}</p></div>
      <button type="button" className="btn btn-ghost" disabled={resource.state.refreshing} onClick={() => resource.refresh()}>{t("inventory.refresh")}</button></div>
    {resource.state.showError && <Notice tone="err">{t("inventory.failed")}</Notice>}
    {data?.partial && <Notice tone="warn">{t("inventory.partial")}</Notice>}
    <div className="asset-filters"><label className="field-label">{t("inventory.search")}<input className="input" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="asset-kind">{(["all", "skill", "mcp"] as const).map(value => <button key={value} type="button"
        className={`btn btn-sm ${kind === value ? "btn-primary" : "btn-ghost"}`} aria-pressed={kind === value} onClick={() => setKind(value)}>{t(`inventory.${value}`)}</button>)}</div>
      <label className="checkbox"><input type="checkbox" checked={issuesOnly} onChange={event => setIssuesOnly(event.target.checked)} />{t("inventory.issues")}</label></div>
    {resource.state.showSkeleton ? <p className="muted">{t("common.loading")}</p> : <p className="muted text-label">{t("inventory.count", { n: matches.length })}</p>}
    <div className="asset-list">{matches.map((entry, index) => <article className="card asset-row" key={`${entry.kind}:${entry.sources[0]}:${entry.name}:${index}`}>
      <div className="asset-row-title"><strong>{entry.name}</strong><span className="badge badge-muted">{t(`inventory.${entry.kind}`)}</span>
        {entry.status !== "present" && <span className={`badge ${entry.status === "linked" ? "badge-muted" : "badge-amber"}`}>{t(`inventory.${entry.status}`)}</span>}
        {entry.duplicate && <span className="badge badge-amber">{t("inventory.duplicate")}</span>}</div>
      <p className="muted text-label">{entry.clients.join(" · ")}{entry.version && <span> · {entry.version}</span>}{entry.transport && <span> · {entry.transport}</span>}</p>
      <details><summary>{t("inventory.source")}</summary>{entry.sources.map(source => <code key={source} className="asset-path">{source}</code>)}
        <p className="muted text-label">{t("inventory.updateUnknown")}</p></details>
    </article>)}</div>
    <details className="asset-coverage"><summary>{t("inventory.coverage")}</summary>
      {data?.sources.map((source, index) => <div key={index}><span>{source.client} · {t(`inventory.${source.kind}`)} · {t(source.status === "read" ? "inventory.read" : source.status === "missing" ? "inventory.missing" : "inventory.unavailable")}</span><code className="asset-path">{source.path}</code></div>)}
    </details>
  </section>;
}
