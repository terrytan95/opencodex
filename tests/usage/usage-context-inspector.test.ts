import { observeCacheDiagnosticInbound, addFinalRequestLog, type RequestLogContext } from "../../src/server/request-log";
import { afterEach, expect, test } from "bun:test";
import { contextSnapshot, finishContext, inspectContext, setContextCapture } from "../../src/usage/context-inspector";
import { handleLogsUsageRoutes } from "../../src/server/management/logs-usage-routes";
import type { ManagementContext } from "../../src/server/management/context";

afterEach(() => { setContextCapture(false); });
const headers = new Headers({ "thread-id": "private-thread-name" });
const body = { instructions: "private instructions", tools: [{ name: "mcp__demo__read", description: "private schema" }],
  input: [{ role: "user", content: "private question" }, { type: "function_call_output", output: "private tool result" }] };

test("disabled capture never touches the request", () => {
  setContextCapture(false);
  const unreadable = new Proxy({}, { get() { throw new Error("body touched"); } });
  expect(inspectContext(unreadable, headers)).toBeUndefined();
});

test("records bounded content-free sections, deltas and observed cache counts", () => {
  setContextCapture(true);
  const first = inspectContext(body, headers, "caller-a")!;
  expect(first.parts.instructions).toBeGreaterThan(0);
  expect(first.parts.mcp).toBeGreaterThan(0);
  expect(first.parts.results).toBeGreaterThan(0);
  finishContext(first, { provider: "fixture", model: "fixture-model", inputTokens: 100, cachedTokens: 0 });
  const second = inspectContext({ ...body, instructions: body.instructions.repeat(10) }, headers, "caller-a")!;
  finishContext(second, { provider: "fixture", model: "fixture-model" });
  const snapshot = contextSnapshot();
  const samples = snapshot.sessions[0]!.samples;
  expect(samples).toHaveLength(2);
  expect(samples[0]!.cachedTokens).toBe(0);
  expect(samples[1]!.cachedTokens).toBeUndefined();
  expect(samples[1]!.delta).toBeGreaterThan(0);
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(JSON.stringify(snapshot)).not.toContain("caller-a");
  snapshot.sessions.splice(0);
  expect(contextSnapshot().sessions).toHaveLength(1);
});

test("isolates callers and unknown sessions and fences in-flight capture after stop/restart", () => {
  setContextCapture(true);
  const a = inspectContext(body, headers, "a")!;
  expect(inspectContext(body, headers, "b")!.session).not.toBe(a.session);
  expect(inspectContext(body, new Headers())!.session).not.toBe(inspectContext(body, new Headers())!.session);
  setContextCapture(false);
  finishContext(a, { provider: "fixture", model: "fixture" });
  expect(contextSnapshot().sessions).toHaveLength(0);
  setContextCapture(true);
  finishContext(a, { provider: "fixture", model: "fixture" });
  expect(contextSnapshot().sessions).toHaveLength(0);
});

test("capture expires and large/deep input has a strict work budget", () => {
  setContextCapture(true, 100);
  expect(inspectContext(body, headers, "a", 100 + 30 * 60_000)).toBeUndefined();
  setContextCapture(true);
  const huge = inspectContext({ input: [{ role: "user", content: "x".repeat(4 * 1024 * 1024) }] }, headers)!;
  expect(huge.truncated).toBe(true);
  expect(huge.estimatedTokens).toBeLessThan(300_000);
  let deep: unknown = "x";
  for (let i = 0; i < 100; i++) deep = [deep];
  expect(inspectContext({ input: deep }, headers)!.truncated).toBe(true);
});

test("retention caps sessions and requests without retaining body text", () => {
  setContextCapture(true);
  for (let i = 0; i < 70; i++) {
    const h = new Headers({ "thread-id": String(i) });
    finishContext(inspectContext(body, h), { provider: "fixture", model: "fixture" });
  }
  expect(contextSnapshot().sessions).toHaveLength(64);
  for (let i = 0; i < 40; i++) finishContext(inspectContext(body, headers), { provider: "fixture", model: "fixture" });
  expect(contextSnapshot().sessions[0]!.samples).toHaveLength(32);
});

test("management capture validates its entire input and marks responses no-store", async () => {
  const invoke = (method: string, value?: unknown) => {
    const req = new Request("http://localhost/api/context-inspector", { method,
      ...(method === "GET" ? {} : { body: JSON.stringify(value), headers: { "Content-Type": "application/json" } }) });
    return handleLogsUsageRoutes({ req, url: new URL(req.url) } as ManagementContext);
  };
  for (const value of [null, {}, { enabled: "yes" }, { enabled: true, prompt: "unexpected" }]) {
    expect((await invoke("PUT", value))?.status).toBe(400);
  }
  const response = (await invoke("PUT", { enabled: true }))!;
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect((await response.json()).enabled).toBe(true);
  expect((await invoke("GET"))?.status).toBe(200);
});


test("request logging publishes one summary without persisting capture metadata", () => {
  setContextCapture(true);
  const ctx: RequestLogContext = { provider: "fixture", model: "fixture-model", apiKeyId: "caller",
    usage: { inputTokens: 100, outputTokens: 2, cachedInputTokens: 20 } };
  observeCacheDiagnosticInbound(ctx, body, headers, "caller");
  const rows: unknown[] = [];
  addFinalRequestLog("fixture-request", Date.now(), ctx, 200, undefined, row => rows.push(row));
  expect(contextSnapshot().sessions[0]!.samples[0]!.reportedTokens).toBe(100);
  expect(contextSnapshot().sessions[0]!.samples[0]!.cachedTokens).toBe(20);
  expect(JSON.stringify(rows)).not.toContain("contextDraft");
  expect(JSON.stringify(rows)).not.toContain("private");
  expect(ctx.contextDraft).toBeUndefined();
});


test("a concrete retry does not capture another logical request", () => {
  setContextCapture(true);
  const child: RequestLogContext = { provider: "fixture", model: "fixture-model" };
  observeCacheDiagnosticInbound(child, body, headers, "caller", false);
  expect(child.contextDraft).toBeUndefined();
});


test("native Chat and Messages bodies retain the same bounded composition", () => {
  setContextCapture(true);
  const chat = inspectContext({ messages: [{ role: "system", content: "fixture instructions" }, { role: "user", content: "fixture request" }, { role: "tool", content: "fixture result" }], tools: [{ type: "function", function: { name: "mcp__fixture__read", description: "fixture tool" } }] }, headers)!;
  expect(chat.parts.instructions).toBeGreaterThan(0); expect(chat.parts.mcp).toBeGreaterThan(0); expect(chat.parts.results).toBeGreaterThan(0);
  const messages = inspectContext({ system: [{ type: "text", text: "fixture instructions" }], messages: [{ role: "user", content: [{ type: "tool_result", content: "fixture result" }] }] }, headers)!;
  expect(messages.parts.instructions).toBeGreaterThan(0); expect(messages.parts.results).toBeGreaterThan(0);
});
