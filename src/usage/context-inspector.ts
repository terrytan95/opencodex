import { createHmac, randomBytes } from "node:crypto";
import { estimateTokens } from "../lib/token-estimate";
import { sanitizeLogMetadataString } from "../lib/redact";

import { CONTEXT_PARTS, type ContextPart, type ContextDraft, type ContextSample, type ContextSession, type ContextSnapshot } from "./context-inspector-types";
export type { ContextSnapshot, ContextSample, ContextDraft } from "./context-inspector-types";
const SALT = randomBytes(32);
const MAX_SESSIONS = 64;
const MAX_SAMPLES = 32;
let generation = 0;
let expiresAt = 0;
const sessions = new Map<string, ContextSession>();
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export function setContextCapture(enabled: boolean, now = Date.now()): ContextSnapshot {
  generation++;
  expiresAt = enabled ? now + 30 * 60_000 : 0;
  if (enabled) sessions.clear();
  return contextSnapshot(now);
}

export function contextSnapshot(now = Date.now()): ContextSnapshot {
  return { enabled: now < expiresAt, expiresAt, sessions: structuredClone([...sessions.values()].reverse()) };
}

/** No body reads, hashing or allocations while capture is off. */
export function inspectContext(body: unknown, headers: Headers, caller = "loopback", now = Date.now()): ContextDraft | undefined {
  if (now >= expiresAt) return;
  const request = record(body);
  if (!request) return;
  const session = headers.get("thread-id") ?? headers.get("session_id") ?? headers.get("session-id") ?? headers.get("x-session-id");
  // Missing identity is an independent request, never a shared anonymous conversation.
  const identity = session && session.length <= 512 ? session : randomBytes(12).toString("hex");
  const key = createHmac("sha256", SALT).update(caller).update("\0").update(identity).digest("hex").slice(0, 16);
  const parts = Object.fromEntries(CONTEXT_PARTS.map(part => [part, 0])) as Record<ContextPart, number>;
  const largest: ContextDraft["largest"] = [];
  let nodes = 4096;
  let chars = 256 * 1024;
  let truncated = false;
  function count(value: unknown, depth = 0): number {
    if (--nodes < 0 || depth > 16 || chars <= 0) { truncated = true; return 0; }
    if (typeof value === "string") {
      const bounded = value.slice(0, chars);
      chars -= bounded.length;
      if (bounded.length < value.length) truncated = true;
      if (bounded.startsWith("data:")) { truncated = true; return 0; }
      return estimateTokens(bounded, "");
    }
    let sum = 0;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        sum += count(value[i], depth + 1);
        if (nodes <= 0 || chars <= 0) { truncated = true; break; }
      }
    } else if (value && typeof value === "object") {
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        sum += count((value as Record<string, unknown>)[name], depth + 1);
        if (nodes <= 0 || chars <= 0) { truncated = true; break; }
      }
    }
    return sum;
  }
  function add(part: ContextPart, value: unknown, index: number) {
    const tokens = count(value);
    parts[part] += tokens;
    if (tokens > 0) {
      largest.push({ part, tokens, index });
      largest.sort((a, b) => b.tokens - a.tokens);
      if (largest.length > 8) largest.pop();
    }
  }
  add("instructions", request.instructions ?? request.system, 0);
  const tools = Array.isArray(request.tools) ? request.tools : [];
  for (let i = 0; i < tools.length && nodes > 0 && chars > 0; i++) {
    const tool = record(tools[i]);
    const name = tool?.name ?? record(tool?.function)?.name;
    add(typeof name === "string" && /^mcp[_.]/.test(name) ? "mcp" : "tools", tools[i], i + 1);
  }
  const input = request.input ?? request.messages;
  if (typeof input === "string") add("conversation", input, 1);
  else if (Array.isArray(input)) {
    for (let i = 0; i < input.length && nodes > 0 && chars > 0; i++) {
      const item = record(input[i]);
      const part = item?.role === "system" || item?.role === "developer" ? "instructions"
        : item?.role === "tool" || item?.type === "function_call_output" ? "results"
        : item?.type === "input_file" || item?.type === "input_image" ? "files" : "conversation";
      if (part === "conversation" && Array.isArray(item?.content)) {
        for (const block of item.content) {
          const content = record(block);
          const kind = content?.type;
          const category = kind === "input_file" || kind === "input_image" || kind === "image_url" || kind === "image" ? "files"
            : kind === "tool_result" ? "results" : part;
          add(category, block, i + 1);
          if (nodes <= 0 || chars <= 0) break;
        }
      } else add(part, input[i], i + 1);
    }
  }
  if (nodes <= 0 || chars <= 0) truncated = true;
  return { session: key, generation, parts, estimatedTokens: Object.values(parts).reduce((a, b) => a + b, 0),
    truncated, remoteHistory: typeof request.previous_response_id === "string", largest };
}

export function finishContext(draft: ContextDraft | undefined, facts: {
  provider: string; model: string; inputTokens?: number; cachedTokens?: number;
}, now = Date.now()): void {
  if (!draft || draft.generation !== generation || now >= expiresAt) return;
  const session = sessions.get(draft.session) ?? { id: draft.session, samples: [] };
  const previous = session.samples.at(-1);
  const { parts, estimatedTokens, truncated, remoteHistory, largest } = draft;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  session.samples.push({ at: now, provider: sanitizeLogMetadataString(facts.provider)?.slice(0, 128) ?? "",
    model: sanitizeLogMetadataString(facts.model)?.slice(0, 128) ?? "", parts, estimatedTokens, truncated, remoteHistory, largest,
    ...(finite(facts.inputTokens) ? { reportedTokens: facts.inputTokens } : {}),
    ...(finite(facts.cachedTokens) ? { cachedTokens: facts.cachedTokens } : {}),
    ...(previous && !truncated && !previous.truncated ? { delta: estimatedTokens - previous.estimatedTokens } : {}),
  });
  if (session.samples.length > MAX_SAMPLES) session.samples.shift();
  sessions.delete(session.id);
  sessions.set(session.id, session);
  if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
}
