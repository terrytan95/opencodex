# Quota Pace

The Codex-only `accountPoolStrategy: "quota-pace"` ranks new assignments and failure alternates
by remaining percentage per hour until the governing reset. `src/codex/quota-pace.ts` pairs
weekly/monthly readings with their own future reset, requires observations within 15 minutes,
and floors the remaining time at one hour. Selection stays in the existing quota winner's known
plan cohort and eligible priority tier; missing evidence keeps the quota winner. Independent
model-quota groups retain ordinary quota selection. Bound sessions and exact selectors keep their
existing ownership. The option is exposed through the dashboard, CLI and management parsers.
The account card expands recent same-window quota history on demand, showing a bounded trend and
sample status. Forecasts never drive selection; sparse, stale or decreasing evidence is unknown.
`gui/src/components/CodexQuotaPace.tsx` makes no history request while collapsed.
