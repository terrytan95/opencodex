# MCP And Skills Inventory

`src/integrations/asset-inventory.ts` reads a declared set of global Codex, Claude Code, Grok and
OpenCode MCP files and skill directories. `src/integrations/asset-inventory-types.ts` owns the
browser-safe DTO. The scanner never launches MCP servers, resolves remote URLs, writes user
files or changes installed skills. Project files, cloud connectors, DSH and plugin-only formats
are outside its coverage; absent sources and unavailable reads remain distinct.

The scan visits at most 24 sources and 512 entries, at most 128 directory children per level,
and two directory levels. Configuration reads are bounded to 1 MiB and SKILL.md to 64 KiB;
only a 4 KiB frontmatter prefix is checked for local version metadata. Async directory walking
yields every 16 inspected items. A process-local 30-second result cache shares concurrent scans;
there is no timer and the hidden page does not poll. Truncated scans mark their response partial.

MCP output includes only name, client, source and transport category; no command, arguments,
environment variables, authorization, remote URL or config body leaves the scan. Skills are
merged by canonical target while retaining client/source membership; broken and unavailable links
are labelled. Same-name distinct sources are flagged without claiming equivalent content.
Paths use existing user/secret redaction, URL-like names are redacted, other names use secret filtering, and update status remains
unknown because no network check runs. Linked skill directories can point elsewhere, but the
only file read there is bounded regular SKILL.md; linked SKILL.md files and special files refuse.

`src/server/management/asset-inventory-routes.ts` exposes authenticated GET /api/asset-inventory
with no-store responses. `gui/src/pages/integrations/AssetInventoryPage.tsx` is loaded lazily in
Connect, with search, kind and attention filters, source disclosures and coverage status.
Tests: `tests/clients/integrations-asset-inventory.test.ts`.

Source discovery stays inside the selected HOME or explicit client-home overrides; WSL Windows-profile
enumeration is not run by this inventory. Claude's global MCP JSON is a sibling of its custom config
directory, matching the existing Claude resolver.
