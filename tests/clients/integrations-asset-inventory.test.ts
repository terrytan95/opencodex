import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inventorySources, scanAssetInventory } from "../../src/integrations/asset-inventory";
let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ocx-assets-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test("MCP inventory reveals names and transport, never args, environment, tokens or endpoints", async () => {
  const path = join(root, "config.json");
  const raw = JSON.stringify({ mcpServers: { search: { command: "private-command", args: ["private-sentinel"], env: { TOKEN: "private-sentinel" } }, remote: { url: "https://private.example/?token=private-sentinel" } }, auth: "private-sentinel" });
  writeFileSync(path, raw);
  const result = await scanAssetInventory([{ kind: "mcp", client: "fixture", path, format: "json", key: "mcpServers" }]);
  expect(result.entries.map(row => [row.name, row.transport])).toEqual([["remote", "http"], ["search", "stdio"]]);
  expect(JSON.stringify(result)).not.toContain("private");
  expect(readFileSync(path, "utf8")).toBe(raw);
});

test("skills group canonical links, report broken links, and distinguish same-name sources", async () => {
  const first = join(root, "first"); const second = join(root, "second");
  for (const directory of [first, second]) { mkdirSync(join(directory, "review"), { recursive: true }); writeFileSync(join(directory, "review", "SKILL.md"), "---\nname: review\nmetadata:\n  version: 1.2.3\n---\nprivate-skill-body"); }
  if (process.platform !== "win32") { symlinkSync(join(first, "review"), join(second, "alias")); symlinkSync(join(root, "gone"), join(first, "broken")); }
  const result = await scanAssetInventory([{ kind: "skill", client: "a", path: first }, { kind: "skill", client: "b", path: second }]);
  const reviews = result.entries.filter(row => row.name === "review");
  expect(reviews).toHaveLength(2); expect(reviews.every(row => row.duplicate)).toBe(true);
  expect(reviews.every(row => row.version === "1.2.3")).toBe(true);
  if (process.platform !== "win32") {
    expect(reviews.some(row => row.clients.length === 2)).toBe(true);
    expect(result.entries.find(row => row.name === "broken")?.status).toBe("broken");
  }
  expect(JSON.stringify(result)).not.toContain("private-skill-body");
});

test("missing and malformed sources stay distinct and large directories are bounded", async () => {
  const skills = join(root, "skills"); mkdirSync(skills);
  for (let i = 0; i < 140; i++) { const dir = join(skills, `skill-${i}`); mkdirSync(dir); writeFileSync(join(dir, "SKILL.md"), "---\nname: test\n---\n"); }
  const bad = join(root, "bad.json"); writeFileSync(bad, "{");
  const result = await scanAssetInventory([{ kind: "skill", client: "fixture", path: skills }, { kind: "mcp", client: "fixture", path: bad }, { kind: "mcp", client: "fixture", path: join(root, "missing") }]);
  expect(result.partial).toBe(true); expect(result.entries.length).toBeLessThanOrEqual(128);
  expect(result.sources.map(source => source.status)).toEqual(["read", "unavailable", "missing"]);
});

test("the scan supports bounded TOML and JSONC without executing a server", async () => {
  const toml = join(root, "config.toml"); writeFileSync(toml, '[mcp_servers.demo]\ncommand = "never-run"\n');
  const jsonc = join(root, "opencode.json"); writeFileSync(jsonc, '{// comment\n"mcp":{"demo":{"type":"local","command":["never-run"]}},}');
  const result = await scanAssetInventory([{ kind: "mcp", client: "Codex", path: toml, format: "toml", key: "mcp_servers" }, { kind: "mcp", client: "OpenCode", path: jsonc, format: "json", key: "mcp" }]);
  expect(result.entries).toHaveLength(2); expect(result.entries.every(entry => entry.duplicate)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("never-run");
});

test("source resolution honors isolated client home overrides", () => {
  const sources = inventorySources({ HOME: root, CODEX_HOME: join(root, "cx"), CLAUDE_CONFIG_DIR: join(root, "cl"), GROK_HOME: join(root, "g"), XDG_CONFIG_HOME: join(root, "xdg") });
  expect(sources.find(row => row.client === "Codex" && row.kind === "mcp")?.path).toBe(join(root, "cx", "config.toml"));
  expect(sources.find(row => row.client === "OpenCode" && row.kind === "mcp")?.path).toBe(join(root, "xdg", "opencode", "opencode.json"));
  expect(sources.every(row => row.path.startsWith(root))).toBe(true);
});


test("URL-shaped MCP names are redacted and default discovery stays within the selected home", async () => {
  const path = join(root, "url-names.json");
  writeFileSync(path, JSON.stringify({ mcpServers: { "https://internal.example/mcp": { command: "unused" } } }));
  const result = await scanAssetInventory([{ client: "fixture", kind: "mcp", path, key: "mcpServers" }]);
  expect(result.entries[0]!.name).toBe("[redacted]");
  expect(JSON.stringify(result)).not.toContain("internal.example");
  const sources = inventorySources({ HOME: root, WSL_DISTRO_NAME: "fixture", CLAUDE_CONFIG_DIR: join(root, "custom-claude") });
  expect(sources.find(row => row.client === "Codex" && row.kind === "mcp")?.path).toBe(join(root, ".codex", "config.toml"));
  expect(sources.find(row => row.client === "Claude Code" && row.kind === "mcp")?.path).toBe(join(root, ".claude.json"));
});
