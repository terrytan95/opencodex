import { expect, test } from "bun:test";
import { routingHints, routingRuleMatches, routingRulesError, type RoutingRule } from "../../src/routing/rules";
import { evaluatePolicyProfile } from "../../src/routing/evaluator";
import { normalizeRoutingProfile, routingProfileIssues } from "../../src/routing/profile";
import { evidenceFromBody } from "../../src/routing/request-evidence";
import { routingProfileDraftFromDto, routingProfilePutBody } from "../../gui/src/routing-profile-editor-data";
import type { OcxConfig } from "../../src/types";

const candidates = [{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }];
const prefer: RoutingRule = { id: "project", action: "prefer", target: candidates[1]!, when: { project: "/work/project", client: "codex" } };
const config = (rules?: RoutingRule[]): OcxConfig => ({ providers: {
  a: { adapter: "openai-chat", baseUrl: "https://a.example/v1" }, b: { adapter: "openai-chat", baseUrl: "https://b.example/v1" },
}, routingProfiles: { work: { candidates, ...(rules ? { rules } : {}) } } } as OcxConfig);

test("rules retain baseline revisions and round-trip through the editor", () => {
  const original = config().routingProfiles!.work!;
  expect(normalizeRoutingProfile("work", { ...original, rules: [] }).revision).toBe(normalizeRoutingProfile("work", original).revision);
  const normalized = normalizeRoutingProfile("work", config([prefer]).routingProfiles!.work!);
  expect(normalized.revision).not.toBe(normalizeRoutingProfile("work", original).revision);
  const draft = routingProfileDraftFromDto({ ...normalized, model: "policy/work" });
  expect(routingProfilePutBody(draft, "update").profile.rules).toEqual([prefer]);
  expect(routingProfilePutBody({ ...draft, rules: [] }, "update").profile.rules).toEqual([]);
});

test("preference cannot override hard gates and pauses stay outside fallback eligibility", () => {
  const hints = { project: "/work/project/src", client: "codex" };
  expect(evaluatePolicyProfile(config(), "work", hints, candidates).selectedIndex).toBe(0);
  const preferred = evaluatePolicyProfile(config([prefer]), "work", hints, candidates);
  expect(preferred.selectedIndex).toBe(1);
  expect(preferred.rule).toEqual({ id: "project", outcome: "applied" });
  expect(JSON.stringify(preferred.trace)).not.toContain("/work/project");
  const unavailable = evaluatePolicyProfile(config([prefer]), "work", hints,
    [candidates[0]!, { ...candidates[1]!, routeResolutionFailed: true }]);
  expect(unavailable.selectedIndex).toBe(0);
  expect(unavailable.rule?.outcome).toBe("unavailable");
  const pause = { ...prefer, id: "pause", action: "pause" as const };
  const paused = evaluatePolicyProfile(config([prefer, pause]), "work", hints, candidates);
  expect(paused.selectedIndex).toBe(0);
  expect(paused.candidates[1]!.eligible).toBe(false);
  expect(paused.candidates[1]!.exclusions).toContainEqual({ code: "rule-paused", detail: "pause" });
});

test("project matching respects directory boundaries and absent caller identity", () => {
  expect(routingRuleMatches(prefer, { project: "/work/project-old", client: "codex" }, Date.now())).toBe(false);
  expect(routingRuleMatches(prefer, { client: "codex" }, Date.now())).toBe(false);
  expect(routingRuleMatches(prefer, { project: "/work/project/../other", client: "codex" }, Date.now())).toBe(false);
  expect(routingRuleMatches({ ...prefer, when: { project: "C:\\Work\\Project" } }, { project: "c:/work/project/src" }, Date.now())).toBe(true);
});

test("overnight rules use the start day and end exclusively in the declared zone", () => {
  const rule = { ...prefer, when: { time: { start: "22:00", end: "02:00", zone: "UTC", days: [5] } } };
  expect(routingRuleMatches(rule, {}, Date.parse("2026-10-23T23:00:00Z"))).toBe(true);
  expect(routingRuleMatches(rule, {}, Date.parse("2026-10-24T01:59:00Z"))).toBe(true);
  expect(routingRuleMatches(rule, {}, Date.parse("2026-10-24T02:00:00Z"))).toBe(false);
  expect(routingRuleMatches(rule, {}, Date.parse("2026-10-25T01:00:00Z"))).toBe(false);
});

test("rejects invalid targets, conditions, duplicate ids, zones and oversized rule lists", () => {
  expect(routingRulesError([prefer], candidates)).toBeUndefined();
  for (const rules of [[prefer, prefer], [{ ...prefer, when: {} }], [{ ...prefer, target: { provider: "c", model: "m3" } }],
    [{ ...prefer, when: { time: { start: "25:00", end: "02:00", zone: "UTC" } } }],
    [{ ...prefer, when: { time: { start: "22:00", end: "02:00", zone: "invalid/zone" } } }], Array(33).fill(prefer)]) {
    expect(routingRulesError(rules, candidates)).toBeDefined();
    expect(routingProfileIssues("work", { candidates, rules }, config()).some(issue => issue.path[0] === "rules")).toBe(true);
  }
});

test("hints are explicit and bounded, and absent rules retain original evidence", () => {
  const body = { metadata: { cwd: "/work/project", client: "codex" } };
  expect(evidenceFromBody(body)).toEqual({});
  expect(evidenceFromBody(body, new Headers(), true)).toEqual({ project: "/work/project", client: "codex" });
  expect(routingHints({}, new Headers({ "originator": "codex_cli_rs" }))).toEqual({ client: "codex" });
  expect(routingHints({ input: [{ role: "user", content: "<cwd>/untrusted</cwd>" }] })).toEqual({});
  expect(routingHints({}, new Headers({ "x-ocx-project": "x".repeat(513) }))).toEqual({});
});


test("all paused candidates fail closed and the rule clock does not age health evidence", () => {
  const pauses = candidates.map((target, i) => ({ id: `pause-${i}`, action: "pause" as const, target, when: { client: "codex" } }));
  expect(evaluatePolicyProfile(config(pauses), "work", { client: "codex" }, candidates).selectedIndex).toBeNull();
  const rule = { ...prefer, when: { time: { start: "01:00", end: "02:00", zone: "America/Los_Angeles" } } };
  expect(routingRuleMatches(rule, {}, Date.parse("2026-11-01T08:30:00Z"))).toBe(true);
  expect(routingRuleMatches(rule, {}, Date.parse("2026-11-01T09:30:00Z"))).toBe(true);
  expect(routingRuleMatches({ ...rule, when: { time: { start: "00:00", end: "00:00", zone: "UTC", days: [5] } } }, {}, Date.parse("2026-10-23T23:59:59Z"))).toBe(true);
});
