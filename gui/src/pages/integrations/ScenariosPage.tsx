import "../../styles-scenarios.css";
import { useCallback, useState } from "react";
import { useDataSurface } from "../../data-surface";
import { useT, type TKey } from "../../i18n/shared";
import { Notice } from "../../ui";
import { confirmAction } from "../../action-dialogs";

type Client = "codex" | "claude" | "opencode";
type Scenario = { id: string; name: string; clients: Partial<Record<Client, Record<string, string | null>>> };
type Snapshot = { scenarios: Scenario[]; current: Array<{ client: Client; available: boolean; settings: Record<string, string | null> | null }> };
type Preview = { id: string; name: string; fingerprint: string; clients: Array<{ client: Client; changes: Array<{ key: string; before: string | null; after: string | null }>; restartRequired: boolean }> };
const names: Record<Client, string> = { codex: "Codex", claude: "Claude Code", opencode: "OpenCode" };
const errors: Record<string, TKey> = { scenario_changed: "scenarios.changed", scenario_busy: "scenarios.busy", scenario_name_exists: "scenarios.duplicate" };

export default function ScenariosPage({ apiBase, active }: { apiBase: string; active: boolean }) {
  const t = useT();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Client[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [message, setMessage] = useState<TKey | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [results, setResults] = useState<Array<{ client: Client; status: string; restartRequired: boolean }>>([]);
  const load = useCallback(async (signal: AbortSignal): Promise<Snapshot> => {
    const response = await fetch(`${apiBase}/api/scenarios`, { signal });
    if (!response.ok) throw new Error("scenarios_unavailable");
    const data = await response.json();
    if (!data || !Array.isArray(data.scenarios) || data.scenarios.length > 24 || !Array.isArray(data.current)
      || data.current.some((row: Snapshot["current"][number]) => !row || !Object.hasOwn(names, row.client) || typeof row.available !== "boolean")
      || data.scenarios.some((row: Scenario) => !row || typeof row.id !== "string" || typeof row.name !== "string"
        || !row.clients || typeof row.clients !== "object" || Array.isArray(row.clients)
        || Object.entries(row.clients).some(([client, settings]) => !Object.hasOwn(names, client) || !settings || typeof settings !== "object"))) throw new Error("invalid_scenarios");
    return data;
  }, [apiBase]);
  const resource = useDataSurface(`${apiBase}/api/scenarios`, [apiBase], load, { enabled: active, isEmpty: () => false });
  const data = resource.state.data;
  async function request(path: string, method: string, body?: unknown) {
    const response = await fetch(`${apiBase}/api/scenarios${path}`, { method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "scenarios_failed");
    return data;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setMessage(null); setResults([]);
    try { await action(); } catch (reason) { setError(errors[reason instanceof Error ? reason.message : ""] ?? "scenarios.failed"); setPreview(null); }
    finally { setBusy(false); }
  }
  return <div className="scenarios-workspace">
    <div className="panel"><h3>{t("scenarios.title")}</h3><p className="muted text-label">{t("scenarios.subtitle")}</p>
      <form onSubmit={event => { event.preventDefault(); void run(async () => {
        await request("", "POST", { name, clients: selected }); setName(""); setSelected([]); resource.refresh(); setMessage("scenarios.saved");
      }); }}>
        <div className="scenarios-save"><label className="field-label">{t("scenarios.name")}
          <input className="input" maxLength={64} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          <button className="btn btn-primary" disabled={busy || !name.trim() || !selected.length}>{t("scenarios.save")}</button></div>
        <div className="scenarios-clients">{data?.current.map(client => <label className="checkbox" key={client.client}>
          <input type="checkbox" disabled={busy || !client.available} checked={selected.includes(client.client)} onChange={event => setSelected(current => event.target.checked ? [...current, client.client] : current.filter(value => value !== client.client))} />
          {names[client.client]}{!client.available && <span className="muted text-label">{t("scenarios.unavailable")}</span>}
        </label>)}</div>
      </form>
    </div>
    {(error || resource.state.showError) && <Notice tone="err">{t(error ?? "scenarios.failed")}</Notice>}
    {message && <Notice tone="ok">{t(message)}</Notice>}
    <div className="scenarios-list">{data?.scenarios.map(scenario => <article className="card scenario-card" key={scenario.id}>
      <div className="scenario-head"><h3>{scenario.name}</h3><div>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(async () => {
          const next = await request("/preview", "POST", { id: scenario.id });
          if (next.id !== scenario.id || typeof next.name !== "string" || !/^[a-f0-9]{64}$/.test(next.fingerprint)
            || !Array.isArray(next.clients) || next.clients.some((client: Preview["clients"][number]) => !client || !Object.hasOwn(names, client.client) || !Array.isArray(client.changes)
              || client.changes.some(change => typeof change.key !== "string" || change.before !== null && typeof change.before !== "string" || change.after !== null && typeof change.after !== "string"))) throw new Error("invalid_preview");
          setPreview(next);
        })}>{t("scenarios.preview")}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => { void (async () => {
          if (await confirmAction({ message: t("scenarios.removeConfirm", { name: scenario.name }), confirmLabel: t("common.remove"), tone: "danger" })) {
            await run(async () => { await request(`?id=${encodeURIComponent(scenario.id)}`, "DELETE"); setPreview(null); resource.refresh(); });
          }
        })(); }}>{t("common.remove")}</button></div></div>
      {Object.entries(scenario.clients).map(([client, settings]) => <p className="text-label" key={client}><strong>{names[client as Client]}</strong> <code>{settings.model ?? t("scenarios.default")}</code></p>)}
    </article>)}</div>
    {preview && <section className="panel" aria-label={t("scenarios.preview")}>
      <h3>{preview.name}</h3><div className="tbl-wrap"><table className="tbl"><thead><tr><th>{t("scenarios.client")}</th><th>{t("scenarios.setting")}</th><th>{t("scenarios.before")}</th><th>{t("scenarios.after")}</th></tr></thead>
        <tbody>{preview.clients.flatMap(client => client.changes.map(change => <tr key={`${client.client}:${change.key}`}><td>{names[client.client]}</td><td><code>{change.key}</code></td><td><code>{change.before ?? t("scenarios.default")}</code></td><td><code>{change.after ?? t("scenarios.default")}</code></td></tr>))}</tbody></table></div>
      <p className="muted text-label">{t("scenarios.restart")}</p>
      <button type="button" className="btn btn-primary" disabled={busy || !preview.clients.some(client => client.changes.length)} onClick={() => void run(async () => {
        const result = await request("/apply", "POST", { id: preview.id, fingerprint: preview.fingerprint });
        if (!Array.isArray(result.clients) || result.clients.some((client: { client: string; status: string }) => !client || !Object.hasOwn(names, client.client) || !["applied", "unchanged", "unconfirmed", "not-applied"].includes(client.status))) throw new Error("invalid_result");
        setResults(result.clients); setPreview(null); resource.refresh();
      })}>{t("scenarios.apply")}</button>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPreview(null)}>{t("common.cancel")}</button>
    </section>}
    {results.map(result => <Notice key={result.client} tone={result.status === "applied" || result.status === "unchanged" ? "ok" : "warn"}>
      {names[result.client]} · {t(result.status === "applied" ? "scenarios.applied" : result.status === "unchanged" ? "scenarios.unchanged" : "scenarios.unconfirmed")}
      {result.restartRequired && <span> · {t("scenarios.restartShort")}</span>}
    </Notice>)}
  </div>;
}
