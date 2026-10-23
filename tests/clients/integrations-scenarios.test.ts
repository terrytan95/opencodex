import * as atomic from "../../src/config/atomic-write";
import { afterEach, beforeEach, expect, test, spyOn } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyWorkspaceScenario, previewWorkspaceScenario, readWorkspaceScenarios, removeWorkspaceScenario, saveWorkspaceScenario, scenarioCurrent } from "../../src/integrations/scenarios";
import { patchScenarioClient, readScenarioClient, type ScenarioClient } from "../../src/integrations/scenario-clients";
let root: string;
let home: string | undefined;
let paths: Record<ScenarioClient, string>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ocx-scenarios-")); home = process.env.OPENCODEX_HOME;
  process.env.OPENCODEX_HOME = join(root, "ocx");
  paths = { codex: join(root, "config.toml"), claude: join(root, "settings.json"), opencode: join(root, "opencode.json") };
  writeFileSync(paths.codex, '# keep comment\nmodel = "openai/test" # picker\nmodel_reasoning_effort = "high"\n[model_providers.custom]\napi_key = "private-sentinel"\n');
  writeFileSync(paths.claude, JSON.stringify({ model: "fixture-claude", modelSettings: { "fixture-claude": { effortLevel: "high", maxEffortLevel: "xhigh" } }, env: { ANTHROPIC_AUTH_TOKEN: "private-sentinel" }, permissions: { allow: ["Read"] } }, null, 2));
  writeFileSync(paths.opencode, JSON.stringify({ model: "opencodex/test", small_model: "opencodex/small", provider: { custom: { options: { apiKey: "private-sentinel" } } } }));
});
afterEach(() => { if (home === undefined) delete process.env.OPENCODEX_HOME; else process.env.OPENCODEX_HOME = home; rmSync(root, { recursive: true, force: true }); });

test("captures only model settings and previews without writing client files", () => {
  const before = readFileSync(paths.codex, "utf8");
  const saved = saveWorkspaceScenario("Work", ["codex", "claude", "opencode"], paths);
  expect(readFileSync(paths.codex, "utf8")).toBe(before);
  expect(JSON.stringify(readWorkspaceScenarios())).not.toContain("private-sentinel");
  const preview = previewWorkspaceScenario(saved.id, paths);
  expect(preview.clients.every(client => !client.changes.length)).toBe(true);
  expect(JSON.stringify(preview)).not.toContain("private-sentinel");
  expect(JSON.stringify(scenarioCurrent(paths))).not.toContain("private-sentinel");
});

test("applies model scalars while preserving credentials, comments and unrelated settings", () => {
  const saved = saveWorkspaceScenario("Work", ["codex", "claude", "opencode"], paths);
  writeFileSync(paths.codex, readFileSync(paths.codex, "utf8").replace('"openai/test"', '"openai/other"'));
  const claude = JSON.parse(readFileSync(paths.claude, "utf8")); claude.modelSettings["fixture-claude"].effortLevel = "low";
  writeFileSync(paths.claude, JSON.stringify(claude));
  const preview = previewWorkspaceScenario(saved.id, paths);
  expect(preview.clients[0]!.changes).toEqual([{ key: "model", before: "openai/other", after: "openai/test" }]);
  const result = applyWorkspaceScenario(saved.id, preview.fingerprint, paths);
  expect(result.clients.map(client => client.status)).toEqual(["applied", "applied", "unchanged"]);
  expect(readFileSync(paths.codex, "utf8")).toContain('# picker');
  expect(readFileSync(paths.codex, "utf8")).toContain('api_key = "private-sentinel"');
  const applied = JSON.parse(readFileSync(paths.claude, "utf8"));
  expect(applied.env.ANTHROPIC_AUTH_TOKEN).toBe("private-sentinel");
  expect(applied.permissions).toEqual({ allow: ["Read"] });
  expect(applied.modelSettings["fixture-claude"]).toEqual({ effortLevel: "high", maxEffortLevel: "xhigh" });
});

test("any stale preview fails before writing any client", () => {
  const saved = saveWorkspaceScenario("Work", ["codex", "claude"], paths);
  writeFileSync(paths.codex, readFileSync(paths.codex, "utf8").replace("high", "low"));
  const preview = previewWorkspaceScenario(saved.id, paths);
  writeFileSync(paths.claude, readFileSync(paths.claude, "utf8") + "\n");
  expect(() => applyWorkspaceScenario(saved.id, preview.fingerprint, paths)).toThrow("scenario_changed");
  expect(readFileSync(paths.codex, "utf8")).toContain('model_reasoning_effort = "low"');
});

test("invalid and missing files refuse without recreating settings or dropping saved scenarios", () => {
  expect(() => saveWorkspaceScenario("Work", ["unknown"], paths)).toThrow("invalid_scenario");
  const saved = saveWorkspaceScenario("Work", ["codex"], paths);
  expect(() => saveWorkspaceScenario("work", ["codex"], paths)).toThrow("scenario_name_exists");
  writeFileSync(paths.codex, "not valid TOML");
  expect(() => previewWorkspaceScenario(saved.id, paths)).toThrow();
  expect(scenarioCurrent(paths)[0]!.available).toBe(false);
  removeWorkspaceScenario(saved.id);
  expect(readWorkspaceScenarios()).toEqual([]);
  expect(readFileSync(paths.codex, "utf8")).toBe("not valid TOML");
});

test("unrepresentable JSON and symlinked client files fail closed", () => {
  writeFileSync(paths.opencode, '{"model":"fixture","value":9007199254740993}');
  expect(() => readScenarioClient("opencode", paths.opencode)).toThrow();
  if (process.platform !== "win32") {
    const link = join(root, "linked.toml"); symlinkSync(paths.codex, link);
    expect(() => saveWorkspaceScenario("Link", ["codex"], { ...paths, codex: link })).toThrow();
  }
  expect(() => patchScenarioClient("codex", readFileSync(paths.codex, "utf8"), { model: "x", secret: "bad" })).toThrow("invalid_scenario");
});

test("invalid scenario store contents never become public metadata", () => {
  mkdirSync(process.env.OPENCODEX_HOME!, { recursive: true });
  writeFileSync(join(process.env.OPENCODEX_HOME!, "workspace-scenarios.json"), '[{"credentials":"private-sentinel"}]');
  expect(() => readWorkspaceScenarios()).toThrow("scenario_store_unavailable");
});


test("a publication failure reports partial outcomes and stops later client writes", () => {
  const saved = saveWorkspaceScenario("Work", ["codex", "claude", "opencode"], paths);
  writeFileSync(paths.codex, readFileSync(paths.codex, "utf8").replace("high", "low"));
  writeFileSync(paths.claude, readFileSync(paths.claude, "utf8").replace("fixture-claude", "other-model"));
  writeFileSync(paths.opencode, readFileSync(paths.opencode, "utf8").replace("opencodex/test", "opencodex/other"));
  const preview = previewWorkspaceScenario(saved.id, paths);
  const original = atomic.atomicWriteFileNoFollowUnclaimed;
  let calls = 0;
  const spy = spyOn(atomic, "atomicWriteFileNoFollowUnclaimed").mockImplementation((...args) => {
    if (++calls === 2) throw new Error("fixture failure");
    return original(...args);
  });
  try {
    const result = applyWorkspaceScenario(saved.id, preview.fingerprint, paths);
    expect(result.clients.map(client => client.status)).toEqual(["applied", "unconfirmed", "not-applied"]);
    expect(readFileSync(paths.codex, "utf8")).toContain('model_reasoning_effort = "high"');
    expect(readFileSync(paths.opencode, "utf8")).toContain("opencodex/other");
  } finally { spy.mockRestore(); }
});
