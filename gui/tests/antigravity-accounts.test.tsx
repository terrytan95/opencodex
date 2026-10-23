import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LanguageProvider } from "../src/i18n/provider";
import AntigravityAccounts from "../src/pages/AntigravityAccounts";
import { readPageFromHash, resolveAppHashChange } from "../src/app-routing";

const globals = ["window", "document", "navigator", "localStorage", "fetch", "IS_REACT_ACT_ENVIRONMENT"] as const;
let previous: Record<(typeof globals)[number], PropertyDescriptor | undefined>;
let win: Window;
let host: HTMLElement;
let root: Root;
let selected: string;
let paused: boolean;
let failRoster: boolean;
let failQuota: boolean;
let empty: boolean;
let requests: Array<{ url: string; method: string; body?: Record<string, unknown> }>;

beforeEach(() => {
  previous = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])) as typeof previous;
  win = new Window({ url: "http://localhost/#antigravity" });
  Object.defineProperty(win.navigator, "language", { value: "en-US", configurable: true });
  selected = "one"; paused = false; failRoster = false; failQuota = false; empty = false; requests = [];
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: win }, document: { configurable: true, value: win.document },
    navigator: { configurable: true, value: win.navigator }, localStorage: { configurable: true, value: win.localStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    fetch: { configurable: true, value: async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ url, method: init?.method ?? "GET", body });
      if (url.endsWith("/active")) selected = body.accountId;
      if (url.endsWith("/pause")) paused = body.paused;
      if (init?.method === "PUT") return Response.json({ activeAccountId: selected });
      if (url.includes("/status?")) return Response.json({ loggedIn: !empty });
      if (failRoster || (failQuota && url.includes("quota=1"))) return new Response(null, { status: 503 });
      return Response.json({ activeAccountId: empty ? null : selected, accounts: empty ? [] : ["one", "two"].map(id => ({
        id, email: `${id}@example.test`, active: id === selected, paused: id === "two" && paused,
        plan: "g1-pro-tier", quotaMode: "probe",
        ...(url.includes("quota=1") ? { quota: { updatedAt: Date.now(), customWindows: [{ label: "Gemini", percent: 25 }] } } : {}),
      })) });
    } },
  });
  host = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.appendChild(host as never);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await win.happyDOM.close();
  for (const key of globals) {
    const descriptor = previous[key];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

async function mount() {
  await act(async () => root.render(<LanguageProvider><AntigravityAccounts apiBase="/pool" /></LanguageProvider>));
}

async function click(button: Element | null | undefined) {
  expect(button).toBeTruthy();
  await act(async () => (button as HTMLElement).click());
}

const button = (text: string) => [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === text);

test("dedicated route loads only Antigravity and preserves selection until an explicit action", async () => {
  expect(readPageFromHash("#antigravity")).toBe("antigravity");
  expect(resolveAppHashChange("antigravity")).toEqual({ page: "antigravity", replaceTo: null });
  await mount();
  expect(host.querySelectorAll(".pwi-auth-acct").length).toBe(2);
  expect(requests.every(request => request.url.includes("provider=google-antigravity"))).toBe(true);
  expect(requests.every(request => request.method === "GET")).toBe(true);
  expect(host.textContent).toContain("g1-pro-tier");
  expect(host.textContent).toContain("Gemini");
  await click(host.querySelectorAll(".pwi-auth-row-main")[1]);
  expect(selected).toBe("two");
  expect(requests.find(request => request.url.endsWith("/active"))?.body).toEqual({ provider: "google-antigravity", accountId: "two" });
  expect(host.querySelectorAll(".pwi-auth-row-main")[1].getAttribute("aria-current")).toBe("true");
  await click(host.querySelectorAll(".pwi-auth-acct")[1].querySelector('button[aria-label="Pause — two@example.test"]'));
  expect(paused).toBe(true);
  expect((host.querySelectorAll(".pwi-auth-row-main")[1] as HTMLButtonElement).disabled).toBe(true);
  await click(button("Refresh quotas"));
  expect(requests.some(request => request.url.includes("quota=1&refresh=1"))).toBe(true);
});

test("failed roster retries and failed quota keeps cards with an unavailable state", async () => {
  failRoster = true;
  await mount();
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
  failRoster = false;
  await click(button("Retry"));
  expect(host.querySelectorAll(".pwi-auth-acct").length).toBe(2);
  failQuota = true;
  await click(button("Refresh quotas"));
  expect(host.querySelectorAll('[data-quota-state="unavailable"]').length).toBe(2);
  expect(host.querySelectorAll(".pwi-auth-acct").length).toBe(2);
});

test("empty pool can start login only through the existing confirmation dialog", async () => {
  empty = true;
  await mount();
  expect(host.querySelectorAll(".pwi-auth-acct").length).toBe(0);
  expect(button("Login")).toBeTruthy();
  await click(button("Login"));
  expect(host.querySelector("dialog")).toBeTruthy();
  expect(requests.every(request => request.method === "GET")).toBe(true);
});
