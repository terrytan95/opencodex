import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("production entry defers other locales and App defers page modules", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await build({
    root, configFile: root + "vite.config.ts", logLevel: "silent",
    build: { write: false, reportCompressedSize: false },
  });
  if (Array.isArray(result) || !("output" in result)) throw new Error("expected one browser build");
  const chunks = result.output.filter(output => output.type === "chunk");
  const entry = chunks.find(chunk => chunk.isEntry)!;
  const app = chunks.find(chunk => chunk.facadeModuleId?.endsWith("/src/App.tsx"))!;
  const staticModules = (fileName: string, seen = new Set<string>()): string[] => {
    if (seen.has(fileName)) return [];
    seen.add(fileName);
    const chunk = chunks.find(candidate => candidate.fileName === fileName)!;
    return [...Object.keys(chunk.modules), ...chunk.imports.flatMap(path => staticModules(path, seen))];
  };
  const initial = staticModules(entry.fileName);
  expect(initial.filter(path => /\/i18n\/(de|fr|ko|zh|zh-TW|ru|ja|tr|vi|pt)\.ts$/.test(path))).toEqual([]);
  for (const locale of ["de", "fr", "ko", "zh", "zh-TW", "ru", "ja", "tr", "vi", "pt"]) {
    expect(chunks.some(chunk => chunk.facadeModuleId?.endsWith(`/i18n/${locale}.ts`))).toBe(true);
  }
  const shell = staticModules(app.fileName);
  for (const page of ["Dashboard", "Providers", "Models", "Advisor", "Subagents", "Logs", "Usage",
    "Storage", "CodexSet", "Integrations", "Startup", "RemoteWorkspace", "RemoteLink"]) {
    expect(shell.some(path => path.endsWith(`/pages/${page}.tsx`))).toBe(false);
    expect(chunks.some(chunk => chunk.facadeModuleId?.endsWith(`/pages/${page}.tsx`))).toBe(true);
  }
}, 30_000);
