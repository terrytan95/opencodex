import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/paths";
import { atomicWriteFile, atomicWriteFileNoFollowUnclaimed } from "../config/atomic-write";
import { readBoundedRegularFileSync } from "../lib/bounded-file-read";
import { publishConfigWrite, withConfigWriteLock } from "../codex/config-write-lock";
import { SCENARIO_CLIENTS, patchScenarioClient, readScenarioClient, scenarioPaths,
  validScenarioSettings, type ScenarioClient, type ScenarioSettings } from "./scenario-clients";

export interface WorkspaceScenario {
  id: string;
  name: string;
  createdAt: number;
  clients: Partial<Record<ScenarioClient, ScenarioSettings>>;
}
const secret = randomBytes(32);
const digest = (value: unknown) => createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
const storePath = () => join(getConfigDir(), "workspace-scenarios.json");
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const validName = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 64 && !/[\x00-\x1f\x7f]/.test(value);

export function readWorkspaceScenarios(): WorkspaceScenario[] {
  let raw: string;
  try { raw = readBoundedRegularFileSync(storePath(), 256 * 1024).toString("utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw new Error("scenario_store_unavailable"); }
  let rows: unknown;
  try { rows = JSON.parse(raw); } catch { throw new Error("scenario_store_unavailable"); }
  if (!Array.isArray(rows) || rows.length > 24 || rows.some(row => !plain(row)
    || !Object.keys(row).every(key => ["id", "name", "createdAt", "clients"].includes(key))
    || typeof row.id !== "string" || !/^[a-f0-9-]{36}$/.test(row.id) || !validName(row.name)
    || typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt) || !plain(row.clients)
    || !Object.keys(row.clients).length || Object.keys(row.clients).some(key => !SCENARIO_CLIENTS.includes(key as ScenarioClient)
      || !validScenarioSettings(key as ScenarioClient, (row.clients as Record<string, unknown>)[key])))) throw new Error("scenario_store_unavailable");
  return rows as WorkspaceScenario[];
}

export function scenarioCurrent(paths = scenarioPaths()) {
  return SCENARIO_CLIENTS.map(client => {
    try { return { client, available: true, settings: readScenarioClient(client, paths[client]).settings }; }
    catch { return { client, available: false, settings: null }; }
  });
}

function mutateStore<T>(mutate: (rows: WorkspaceScenario[]) => T): T {
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
  const result = withConfigWriteLock(storePath(), held => {
    const rows = readWorkspaceScenarios();
    const result = mutate(rows);
    publishConfigWrite(storePath(), held, (path, hooks) => atomicWriteFile(path, JSON.stringify(rows, null, 2) + "\n", undefined, hooks));
    return result;
  });
  if (!result.ok) throw new Error("scenario_busy");
  return result.value;
}

export function saveWorkspaceScenario(name: unknown, clients: unknown, paths = scenarioPaths()): WorkspaceScenario {
  if (!validName(name) || !Array.isArray(clients) || !clients.length || clients.length > 3
    || new Set(clients).size !== clients.length || clients.some(client => !SCENARIO_CLIENTS.includes(client))) throw new Error("invalid_scenario");
  const selected: Partial<Record<ScenarioClient, ScenarioSettings>> = {};
  for (const client of clients as ScenarioClient[]) selected[client] = readScenarioClient(client, paths[client]).settings;
  return mutateStore(rows => {
    if (rows.length >= 24 || rows.some(row => row.name.toLowerCase() === name.trim().toLowerCase())) throw new Error("scenario_name_exists");
    const row = { id: randomUUID(), name: name.trim(), createdAt: Date.now(), clients: selected };
    rows.push(row); return row;
  });
}

export function removeWorkspaceScenario(id: string): void {
  mutateStore(rows => { const index = rows.findIndex(row => row.id === id); if (index < 0) throw new Error("scenario_not_found"); rows.splice(index, 1); });
}

function scenarioPlan(scenario: WorkspaceScenario, paths: Record<ScenarioClient, string>) {
  const plans = SCENARIO_CLIENTS.filter(client => scenario.clients[client]).map(client => {
    const current = readScenarioClient(client, paths[client]);
    const target = scenario.clients[client]!;
    const changes = Object.keys(target).filter(key => current.settings[key] !== target[key])
      .map(key => ({ key, before: current.settings[key] ?? null, after: target[key] ?? null }));
    const next = changes.length ? patchScenarioClient(client, current.raw, target) : current.raw;
    return { client, path: paths[client], raw: current.raw, next, changes };
  });
  return { plans, fingerprint: digest([scenario, plans.map(plan => [plan.client, plan.path, plan.raw, plan.next])]) };
}
function find(id: string): WorkspaceScenario {
  const scenario = readWorkspaceScenarios().find(row => row.id === id);
  if (!scenario) throw new Error("scenario_not_found");
  return scenario;
}
export function previewWorkspaceScenario(id: string, paths = scenarioPaths()) {
  const scenario = find(id); const { plans, fingerprint } = scenarioPlan(scenario, paths);
  return { id, name: scenario.name, fingerprint, clients: plans.map(({ client, changes }) => ({ client, changes, restartRequired: changes.length > 0 })) };
}

export function applyWorkspaceScenario(id: string, fingerprint: string, paths = scenarioPaths()) {
  const scenario = find(id);
  const clients = SCENARIO_CLIENTS.filter(client => scenario.clients[client]);
  type Held = Parameters<Parameters<typeof withConfigWriteLock>[1]>[0];
  const locks = new Map<ScenarioClient, Held>();
  const run = (index: number): Array<{ client: ScenarioClient; status: "applied" | "unchanged" | "unconfirmed" | "not-applied"; restartRequired: boolean }> => {
    if (index < clients.length) {
      const client = clients[index]!;
      const locked = withConfigWriteLock(paths[client], held => { locks.set(client, held); return run(index + 1); });
      if (!locked.ok) throw new Error("scenario_busy");
      return locked.value;
    }
    const plan = scenarioPlan(find(id), paths);
    if (plan.fingerprint !== fingerprint) throw new Error("scenario_changed");
    let failed = false;
    return plan.plans.map(item => {
      if (failed) return { client: item.client, status: "not-applied", restartRequired: false };
      if (!item.changes.length) return { client: item.client, status: "unchanged", restartRequired: false };
      try {
        publishConfigWrite(item.path, locks.get(item.client)!, (path, hooks) => {
          atomicWriteFileNoFollowUnclaimed(path, item.next, { ...hooks, validateBeforeRename: () => {
            hooks.validateBeforeRename?.(path);
            if (readScenarioClient(item.client, item.path).raw !== item.raw) throw new Error("scenario_changed");
          } });
        });
        return { client: item.client, status: "applied", restartRequired: true };
      } catch { failed = true; return { client: item.client, status: "unconfirmed", restartRequired: true }; }
    });
  };
  const locked = withConfigWriteLock(storePath(), () => ({ clients: run(0) }));
  if (!locked.ok) throw new Error("scenario_busy");
  return locked.value;
}
