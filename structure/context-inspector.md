# Context Inspector

The Usage Context tab loads `gui/src/pages/usage-context.tsx` on demand and polls only while mounted.
`GET /api/context-inspector` returns process-local metadata; `PUT` with an exact boolean `enabled`
starts a fresh 30-minute capture or stops it. `src/server/management/logs-usage-routes.ts` uses existing management authentication and
no-store responses. Older servers return an unavailable state without blocking usage reports.
`src/usage/context-inspector.ts` collects normalized inbound composition through `src/server/request-log.ts`
and attaches final reported input/cache usage without changing the request or usage ledger.
Counts are estimates, not wire-exact billing or a complete view of server-held continuation state.
A capture visits at most 4096 nodes, 256 Ki characters and 16 nesting levels per request; partial
samples are labelled. It retains 64 opaque caller-scoped sessions with 32 numeric samples each,
eight largest numeric contributors, no prompt text, tool names, paths or raw session identity.
Stopping/restarting fences in-flight drafts; capture has no body traversal while disabled.
The pure browser DTO lives in `src/usage/context-inspector-types.ts`. Regression coverage:
`tests/usage/usage-context-inspector.test.ts`.
