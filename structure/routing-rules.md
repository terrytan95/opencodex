# Routing Rules

`src/routing/rules.ts` owns bounded deterministic project/client/time rules for routing profiles.
A profile may hold 32 ordered rules, each with a unique identifier, `prefer` or `pause`, an exact
existing candidate target, and at least one condition. `src/routing/profile.ts` validates and
normalizes the field; absent/empty rules preserve the previous profile revision and behavior.
`src/routing/evaluator.ts` excludes every matching paused target and gives the first matching
preference to its eligible candidate. Preferences never bypass capability, cost, health, quota,
compatibility or explicit candidate gates. An unavailable preferred target retains normal scoring.
The trace includes only rule identifiers and closed outcomes, never project paths or request text.

Projects match exact folders or descendants, with directory boundaries; Windows drive paths are
case-insensitive. Dot traversal is refused. Missing hints never match project/client conditions.
`src/routing/request-evidence.ts` extracts hints only while a profile has rules: explicit
x-ocx-project/x-ocx-client headers, metadata cwd/project/client, or bounded system/developer cwd
markers. Known originator/User-Agent prefixes identify clients. These are caller-provided routing
hints, not authorization or confidentiality boundaries. No proxy working directory is inferred.
The Chat, Messages and Responses entrypoints carry the hints into the existing evaluator,
including direct-protocol and compaction paths. Request bodies are not changed by this feature.

Schedules use an explicit IANA zone and half-open HH:mm bounds. Equal bounds mean a whole day;
overnight schedules use the day on which the window starts. Optional weekdays use Sunday=0.
Zone formatters are bounded to 32 cached entries. There is no polling or scheduling timer.

`src/server/management/routing-profile-routes.ts` returns rules and preserves them when older
editors omit the field on update; explicit [] clears them. Dry-run accepts project/client hints
and an optional epoch-millisecond at value that affects only rule matching, not evidence freshness.
`gui/src/components/RoutingRulesEditor.tsx` edits and reorders rules inside the existing profile
form; save/revision conflict handling remains the existing profile transaction. Regression tests
live in `tests/routing/routing-context-rules.test.ts`.
