import { parseConfig, PARSE_FAILED } from "./config-io";
import { homedir } from "node:os";
import { join } from "node:path";
import { readBoundedRegularFileSync } from "../lib/bounded-file-read";
import { resolveCodexHomeDir } from "../codex/home";
import { claudeConfigDir } from "../claude/auth-detect";
import { opencodeGlobalConfigPath } from "../clients/config-export";
import { setRootString } from "../codex/prompt-layers/toml-edit";

export const SCENARIO_CLIENTS = ["codex", "claude", "opencode"] as const;
export type ScenarioClient = typeof SCENARIO_CLIENTS[number];
export type ScenarioSettings = Record<string, string | null>;
const fields: Record<ScenarioClient, readonly string[]> = {
  codex: ["model", "model_reasoning_effort"],
  claude: ["model", "effortLevel", "modelEffort", "env.ANTHROPIC_MODEL", "env.CLAUDE_CODE_EFFORT_LEVEL"],
  opencode: ["model", "small_model"],
};
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown): string | null => typeof v === "string" && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v) ? v : v == null ? null : (() => { throw new Error("settings_unavailable"); })();

export function scenarioPaths(env: NodeJS.ProcessEnv = process.env): Record<ScenarioClient, string> {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  return { codex: join(resolveCodexHomeDir({ env }), "config.toml"),
    claude: join(claudeConfigDir(env), "settings.json"), opencode: opencodeGlobalConfigPath(env, home) };
}

export function validScenarioSettings(client: ScenarioClient, settings: unknown): settings is ScenarioSettings {
  if (!plain(settings) || Object.keys(settings).length !== fields[client].length) return false;
  return fields[client].every(key => Object.hasOwn(settings, key) && (settings[key] === null
    || typeof settings[key] === "string" && settings[key].length <= 512 && !/[\x00-\x1f\x7f]/.test(settings[key])));
}

function parse(client: ScenarioClient, raw: string): Record<string, unknown> {
  const value: unknown = parseConfig(raw, client === "codex" ? "toml" : "json");
  if (value === PARSE_FAILED || !plain(value)) throw new Error("settings_unavailable");
  return value;
}
function project(client: ScenarioClient, doc: Record<string, unknown>): ScenarioSettings {
  const settings: ScenarioSettings = {};
  for (const key of fields[client]) {
    if (key.startsWith("env.")) {
      if (doc.env !== undefined && !plain(doc.env)) throw new Error("settings_unavailable");
      settings[key] = scalar(plain(doc.env) ? doc.env[key.slice(4)] : null);
    } else if (key === "modelEffort") {
      const model = typeof doc.model === "string" ? doc.model : null;
      if (doc.modelSettings !== undefined && !plain(doc.modelSettings)) throw new Error("settings_unavailable");
      const row = model && plain(doc.modelSettings) ? doc.modelSettings[model] : null;
      if (row != null && !plain(row)) throw new Error("settings_unavailable");
      settings[key] = scalar(plain(row) ? row.effortLevel : null);
    } else settings[key] = scalar(doc[key]);
  }
  return settings;
}

export function readScenarioClient(client: ScenarioClient, path: string) {
  const raw = readBoundedRegularFileSync(path, 1024 * 1024).toString("utf8");
  return { raw, settings: project(client, parse(client, raw)) };
}

/** Only saved model scalars change; credentials, routing connections and other settings survive. */
export function patchScenarioClient(client: ScenarioClient, raw: string, settings: ScenarioSettings): string {
  if (!validScenarioSettings(client, settings)) throw new Error("invalid_scenario");
  const doc = parse(client, raw);
  if (client === "codex") {
    let result = raw;
    for (const key of fields.codex) result = setRootString(result, key, settings[key]!);
    return result;
  }
  function put(target: Record<string, unknown>, key: string, value: string | null) {
    if (value === null) delete target[key]; else Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  }
  for (const key of fields[client]) {
    const value = settings[key]!;
    if (key.startsWith("env.")) {
      if (doc.env !== undefined && !plain(doc.env)) throw new Error("settings_unavailable");
      if (value !== null || plain(doc.env)) { const env = plain(doc.env) ? { ...doc.env } : {}; put(env, key.slice(4), value); doc.env = env; }
    } else if (key === "modelEffort") {
      const model = settings.model;
      if (!model) continue;
      if (doc.modelSettings !== undefined && !plain(doc.modelSettings)) throw new Error("settings_unavailable");
      const models = plain(doc.modelSettings) ? { ...doc.modelSettings } : {};
      const old = Object.hasOwn(models, model) ? models[model] : undefined;
      if (old !== undefined && !plain(old)) throw new Error("settings_unavailable");
      if (value !== null || old !== undefined) {
        const row = plain(old) ? { ...old } : {}; put(row, "effortLevel", value);
        Object.defineProperty(models, model, { value: row, enumerable: true, configurable: true, writable: true });
        doc.modelSettings = models;
      }
    } else put(doc, key, value);
  }
  const indent = raw.match(/\n([ \t]+)"/)?.[1] ?? "  ";
  const next = JSON.stringify(doc, null, indent) + "\n";
  return raw.includes("\r\n") ? next.replaceAll("\n", "\r\n") : next;
}
