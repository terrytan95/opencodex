import { redactSecretString, redactUserPath } from "../lib/redact";
import { opendir, lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readBoundedRegularFileSync } from "../lib/bounded-file-read";
import { resolveCodexHomeDir } from "../codex/home";
import { claudeConfigDir } from "../claude/auth-detect";
import { opencodeGlobalConfigPath } from "../clients/config-export";
import { parseConfig, PARSE_FAILED } from "./config-io";

import type { AssetInventory, AssetSource, InventoryAsset } from "./asset-inventory-types";
export type { AssetInventory, AssetSource } from "./asset-inventory-types";
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const label = (value: string) => /(?:[a-z][a-z0-9+.-]*:\/\/|^www\.)/i.test(value) ? "[redacted]"
  : redactSecretString(value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 128));

export function inventorySources(env: NodeJS.ProcessEnv = process.env): AssetSource[] {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  const configured = env.CODEX_HOME?.trim();
  const selectedHome = configured === "~" ? home : configured?.startsWith("~/") ? join(home, configured.slice(2)) : configured || join(home, ".codex");
  // Inventory is scoped to this home; it never searches other Windows users under WSL.
  const codex = resolveCodexHomeDir({ env: { ...env, CODEX_HOME: selectedHome }, homedir: () => home });
  const claude = claudeConfigDir(env);
  const grok = env.GROK_HOME || join(home, ".grok");
  const opencode = opencodeGlobalConfigPath(env, home);
  return [
    { client: "Codex", kind: "mcp", path: join(codex, "config.toml"), format: "toml", key: "mcp_servers" },
    { client: "Claude Code", kind: "mcp", path: env.CLAUDE_CONFIG_DIR?.trim() ? join(claude, "..", ".claude.json") : join(home, ".claude.json"), format: "json", key: "mcpServers" },
    { client: "Grok", kind: "mcp", path: join(grok, "config.toml"), format: "toml", key: "mcp_servers" },
    { client: "OpenCode", kind: "mcp", path: opencode, format: "json", key: "mcp" },
    { client: "Codex", kind: "skill", path: join(codex, "skills") },
    { client: "Claude Code", kind: "skill", path: join(claude, "skills") },
    { client: "Grok", kind: "skill", path: join(grok, "skills") },
    { client: "OpenCode", kind: "skill", path: join(dirname(opencode), "skills") },
    { client: "OpenCode", kind: "skill", path: join(claude, "skills") },
    { client: "Codex", kind: "skill", path: join(home, ".agents", "skills") },
    { client: "OpenCode", kind: "skill", path: join(home, ".agents", "skills") },
  ];
}

export async function scanAssetInventory(sources: readonly AssetSource[] = inventorySources()): Promise<AssetInventory> {
  const result: AssetInventory = { generatedAt: Date.now(), partial: sources.length > 24, entries: [], sources: [] };
  const canonical = new Map<string, InventoryAsset>();
  const visited = new Set<string>();
  let inspected = 0;
  const add = (key: string, entry: InventoryAsset) => {
    const previous = canonical.get(key);
    if (previous) {
      for (const client of entry.clients) if (!previous.clients.includes(client)) previous.clients.push(client);
      for (const source of entry.sources) if (!previous.sources.includes(source)) previous.sources.push(source);
    } else { canonical.set(key, entry); result.entries.push(entry); }
  };
  for (const source of sources.slice(0, 24)) {
    if (inspected >= 512) { result.partial = true; break; }
    const sourceRow: AssetInventory["sources"][number] = { ...source, status: "read" };
    result.sources.push(sourceRow);
    try {
      if (source.kind === "mcp") {
        const raw = readBoundedRegularFileSync(source.path, 1024 * 1024).toString("utf8");
        const doc = parseConfig(raw, source.format ?? "json", { jsonc: source.client === "OpenCode" });
        if (doc === PARSE_FAILED || !plain(doc)) throw new Error("invalid_inventory_config");
        const servers = doc[source.key ?? "mcpServers"];
        if (servers !== undefined && !plain(servers)) throw new Error("invalid_inventory_config");
        for (const name of Object.keys(servers ?? {}).slice(0, Math.min(128, 512 - inspected))) {
          inspected++;
          const server = (servers as Record<string, unknown>)[name];
          add(`mcp:${source.path}:${name}`, { kind: "mcp", name: label(name), clients: [source.client], sources: [source.path],
            status: plain(server) ? "present" : "unavailable", duplicate: false,
            ...(plain(server) ? { transport: typeof server.command === "string" || Array.isArray(server.command) ? "stdio" : typeof server.url === "string" ? "http" : "unknown" } : {}) });
        }
        if (Object.keys(servers ?? {}).length > 128 || inspected >= 512) result.partial = true;
      } else {
        const queue = [{ path: source.path, depth: 0 }];
        while (queue.length && inspected < 512) {
          const folder = queue.shift()!;
          const visitKey = `${source.client}:${folder.path}`;
          if (visited.has(visitKey)) continue;
          visited.add(visitKey);
          const directory = await opendir(folder.path);
          let count = 0;
          for await (const entry of directory) {
            if (++count > 128 || inspected >= 512) { result.partial = true; break; }
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            inspected++;
            if (inspected % 16 === 0) await Bun.sleep(0);
            const path = join(folder.path, entry.name);
            const item: InventoryAsset = { kind: "skill", name: label(entry.name), clients: [source.client], sources: [path], status: entry.isSymbolicLink() ? "linked" : "present", duplicate: false };
            let target: string;
            try { target = await realpath(path); }
            catch (error) { item.status = (error as NodeJS.ErrnoException).code === "ENOENT" ? "broken" : "unavailable"; add(`skill:${path}`, item); continue; }
            const skill = join(target, "SKILL.md");
            try {
              const stat = await lstat(skill);
              if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsupported_skill_file");
              const raw = readBoundedRegularFileSync(skill, 64 * 1024).toString("utf8");
              const frontmatter = raw.slice(0, 4096).match(/^---\r?\n([\s\S]*?)\r?\n---/);
              const version = frontmatter?.[1]?.match(/^\s*version:\s*["']?([\w.+-]{1,64})["']?\s*$/m)?.[1];
              if (version) item.version = version;
              add(`skill:${target}`, item);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT" && !entry.isSymbolicLink() && folder.depth < 1) {
                queue.push({ path, depth: folder.depth + 1 });
              } else { item.status = "unavailable"; add(`skill:${path}`, item); }
            }
          }
        }
        if (queue.length) result.partial = true;
      }
    } catch (error) {
      sourceRow.status = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
      if (sourceRow.status === "unavailable") result.partial = true;
    }
  }
  const counts = new Map<string, number>();
  for (const entry of result.entries) { const key = `${entry.kind}:${entry.name.toLowerCase()}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  for (const entry of result.entries) entry.duplicate = (counts.get(`${entry.kind}:${entry.name.toLowerCase()}`) ?? 0) > 1;
  for (const entry of result.entries) entry.sources = entry.sources.map(redactUserPath);
  for (const source of result.sources) source.path = redactUserPath(source.path);
  result.entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return result;
}

let cached: { key: string; until: number; value: AssetInventory } | undefined;
let pending: { key: string; value: Promise<AssetInventory> } | undefined;
export async function assetInventory(): Promise<AssetInventory> {
  const sources = inventorySources(); const key = JSON.stringify(sources);
  if (cached?.key === key && cached.until > Date.now()) return structuredClone(cached.value);
  if (pending?.key === key) return structuredClone(await pending.value);
  const job = scanAssetInventory(sources); pending = { key, value: job };
  try { const value = await job; cached = { key, value, until: Date.now() + 30_000 }; return structuredClone(value); }
  finally { if (pending?.value === job) pending = undefined; }
}
