# Workspace Scenarios

`src/integrations/scenario-clients.ts` projects only model defaults and supported effort scalars
from existing Codex TOML, Claude Code settings JSON and OpenCode JSON files. No missing client
file is created, no symlinked file is rewritten, and unrepresentable/invalid configuration refuses.
Codex uses the existing comment-preserving root-key editor. JSON uses the existing lossless-value
parser before serialization; unrelated settings, credentials and permission values are preserved.
Claude captures its default model, legacy/per-model effort and explicit model/effort env overrides;
OpenCode captures model and small_model. Project/launch overrides may still win in the client.

`src/integrations/scenarios.ts` stores at most 24 named sets under the owned
workspace-scenarios.json. Captured values are allowlisted and revalidated on read, with a 256 KiB
store limit and 1 MiB client-file limits. The store and each destination use the existing config
write locks in fixed client order. Previews contain field diffs and a process-keyed HMAC over the
scenario, resolved destinations and current bytes. They contain no full config, credentials or
source text. Applying a stale preview refuses before all writes; validation repeats immediately
before each atomic replacement. A noncooperating client can still write between the final check
and rename; portable filesystem APIs provide no compare-and-replace. Clients must be closed
while applying. Existing caller files are not claimed for uninstall and no
backup is created. `src/config/atomic-write.ts` passes optional publication hooks through its
unclaimed writer so the shared destination witness remains enforced.

Application across clients is not an atomic transaction. Results distinguish applied, unchanged,
unconfirmed and not-applied; after an uncertain publication later clients are skipped. The UI
shows per-client results and restart guidance rather than claiming rollback. Saved selectors can
reference existing combo/policy names but this does not create providers or change endpoints.
`src/server/management/scenario-routes.ts` inherits ordinary management authentication and origin
checks, accepts only bounded explicit request shapes, and returns no-store metadata with closed
error codes. Capture/removal do not modify client settings. The Connect Scenarios tab loads its
component on demand and makes no background polling calls. Its controls save the current values,
preview a stored set, and apply the displayed preview on explicit click.
Tests: `tests/clients/integrations-scenarios.test.ts`.
