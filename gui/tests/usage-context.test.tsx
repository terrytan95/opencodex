import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { clearClientResourceStoresForTests } from "../src/client-resource";
import { LanguageProvider } from "../src/i18n/provider";
import UsageContext from "../src/pages/usage-context";

test("context capture starts, renders bounded samples and stops without other API requests", async () => {
  const keys = ["document", "window", "navigator", "localStorage", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalFetch = globalThis.fetch;
  const browser = new Window({ url: "http://localhost/#usage/context" });
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true,
    value: key === "IS_REACT_ACT_ENVIRONMENT" ? true : key === "window" ? browser : Reflect.get(browser, key) });
  Object.defineProperty(browser.navigator, "language", { configurable: true, value: "en-US" });
  clearClientResourceStoresForTests();
  let enabled = false;
  const writes: boolean[] = [];
  const sample = { at: Date.now(), model: "fixture-model", provider: "fixture", parts: {
    instructions: 100, tools: 20, mcp: 200, files: 0, results: 500, conversation: 80,
  }, estimatedTokens: 900, reportedTokens: 1000, cachedTokens: 0, truncated: false,
  remoteHistory: false, largest: [{ part: "results", tokens: 500, index: 2 }] };
  globalThis.fetch = (async (input, init) => {
    expect(String(input)).toBe("http://context-fixture/api/context-inspector");
    if (init?.method === "PUT") { enabled = JSON.parse(String(init.body)).enabled; writes.push(enabled); }
    return Response.json({ enabled, expiresAt: Date.now() + 1000, sessions: enabled
      ? [{ id: "0123456789abcdef", samples: [sample] }] : [] });
  }) as typeof fetch;
  const { createRoot } = await import("react-dom/client");
  const host = browser.document.createElement("div"); browser.document.body.append(host);
  const root = createRoot(host);
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  try {
    await act(async () => root.render(createElement(LanguageProvider, null, createElement(UsageContext, { apiBase: "http://context-fixture" }))));
    await settle();
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="Capture context"]')!;
    expect(toggle.disabled).toBe(false);
    await act(async () => { toggle.click(); }); await settle();
    expect(writes).toEqual([true]);
    expect(host.querySelector(".context-session")?.textContent).toContain("fixture-model");
    expect(host.textContent).toContain("Cached");
    expect(host.querySelectorAll(".context-legend dt")).toHaveLength(6);
    await act(async () => { toggle.click(); }); await settle();
    expect(writes).toEqual([true, false]);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    clearClientResourceStoresForTests(); globalThis.fetch = originalFetch; browser.close();
    for (const key of keys) { const descriptor = previous.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
