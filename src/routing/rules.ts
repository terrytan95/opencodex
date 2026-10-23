export interface RoutingRule {
  id: string;
  action: "prefer" | "pause";
  target: { provider: string; model: string };
  when: {
    project?: string;
    client?: string;
    time?: { start: string; end: string; zone: string; days?: number[] };
  };
}
export interface RoutingHints { project?: string; client?: string }
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 512): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);
const clock = (v: unknown): v is string => typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const only = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  const existing = formatters.get(zone);
  if (existing) return existing;
  const value = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
  formatters.set(zone, value);
  return value;
}

export function routingRulesError(raw: unknown, candidates: readonly { provider: string; model: string }[]): string | undefined {
  if (raw === undefined) return;
  if (!Array.isArray(raw) || raw.length > 32) return "rules must be an array of at most 32 entries";
  const ids = new Set<string>();
  for (const item of raw) {
    if (!plain(item) || !only(item, ["id", "action", "target", "when"]) || !text(item.id, 64)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item.id) || ids.has(item.id)) return "rule ids must be unique short identifiers";
    ids.add(item.id);
    if (item.action !== "prefer" && item.action !== "pause") return "rule action must be prefer or pause";
    if (!plain(item.target) || !only(item.target, ["provider", "model"])
      || !candidates.some(c => c && typeof c.provider === "string" && typeof c.model === "string" && c.provider.trim() === (item.target as Record<string, unknown>).provider && c.model.trim() === (item.target as Record<string, unknown>).model)) return "rule target must be a profile candidate";
    if (!plain(item.when) || !only(item.when, ["project", "client", "time"]) || !Object.keys(item.when).length) return "rule requires a project, client or time condition";
    if (item.when.project !== undefined && !text(item.when.project)) return "invalid project condition";
    if (item.when.client !== undefined && (!text(item.when.client, 64) || !/^[\w.-]+$/.test(item.when.client))) return "invalid client condition";
    if (item.when.time !== undefined) {
      const time = item.when.time;
      if (!plain(time) || !only(time, ["start", "end", "zone", "days"]) || !clock(time.start) || !clock(time.end)
        || !text(time.zone, 100)) return "time requires HH:mm bounds and a time zone";
      try { formatter(time.zone); } catch { return "invalid time zone"; }
      if (time.days !== undefined && (!Array.isArray(time.days) || !time.days.length || time.days.length > 7
        || new Set(time.days).size !== time.days.length || time.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) return "days must be unique weekdays from 0 (Sunday) to 6";
    }
  }
}

function projectKey(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
export function routingRuleMatches(rule: RoutingRule, hints: RoutingHints, now: number): boolean {
  const { project, client, time } = rule.when;
  if (project !== undefined) {
    if (!hints.project) return false;
    const prefix = projectKey(project); const actual = projectKey(hints.project);
    if (actual.split("/").some(part => part === ".." || part === ".") || prefix.split("/").some(part => part === ".." || part === ".")) return false;
    if (actual !== prefix && !actual.startsWith(`${prefix}/`)) return false;
  }
  if (client !== undefined && client.toLowerCase() !== hints.client?.toLowerCase()) return false;
  if (time) {
    const parts = formatter(time.zone).formatToParts(now);
    const value = (type: string) => parts.find(p => p.type === type)?.value ?? "";
    const minute = `${value("hour")}:${value("minute")}`;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
    const overnight = time.start > time.end;
    const inTime = time.start === time.end ? true : overnight ? minute >= time.start || minute < time.end : minute >= time.start && minute < time.end;
    const startDay = overnight && minute < time.end ? (day + 6) % 7 : day;
    if (!inTime || time.days && !time.days.includes(startDay)) return false;
  }
  return true;
}

/** Caller hints guide an already-authorized candidate set; they grant no access. */
export function routingHints(body: unknown, headers?: Headers): RoutingHints {
  const row = plain(body) ? body : {};
  const metadata = plain(row.metadata) ? row.metadata : {};
  let project = headers?.get("x-ocx-project") ?? metadata.cwd ?? metadata.project;
  const originator = headers?.get("originator") ?? headers?.get("user-agent") ?? "";
  const known = /^(codex|claude|opencode|pi|grok)(?:[\s/_-]|$)/i.exec(originator.slice(0, 128))?.[1];
  const client = headers?.get("x-ocx-client") ?? metadata.client ?? known;
  // Codex's explicit environment marker is bounded; ordinary user text is never inspected.
  if (!project && Array.isArray(row.input)) {
    for (const message of row.input.slice(0, 8)) {
      if (!plain(message) || (message.role !== "developer" && message.role !== "system")) continue;
      const content = typeof message.content === "string" ? message.content
        : Array.isArray(message.content) ? message.content.slice(0, 4).map(p => plain(p) && typeof p.text === "string" ? p.text.slice(0, 4096) : "").join("\n") : "";
      const match = content.slice(0, 16384).match(/<cwd>([^<\r\n]{1,512})<\/cwd>/);
      if (match) { project = match[1]; break; }
    }
  }
  return { ...(text(project) ? { project: project.trim() } : {}),
    ...(text(client, 64) && /^[\w.-]+$/.test(client) ? { client: client.toLowerCase() } : {}) };
}

export function hasRoutingRules(config: { routingProfiles?: Record<string, { rules?: RoutingRule[] }> }): boolean {
  return Object.values(config.routingProfiles ?? {}).some(profile => !!profile.rules?.length);
}
