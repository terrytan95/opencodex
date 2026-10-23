---
title: Model Ordering
description: How opencodex determines model order in the Codex picker and spawn_agent model overrides.
---

The Codex model picker does not preserve the order of provider declarations or model arrays in the
opencodex configuration. Its final order comes from catalog priorities, with a deterministic
alphabetical order for routed models that share the same priority.


Use `modelPickerOrder` to order **all available models**, including featured and native models.
Every nonempty list applies the same rule: listed ids come first in array order; unlisted rows
follow in their natural priority order. No native id is required to activate this behavior.

## The rule Codex applies

Codex's models-manager sorts picker-visible catalog entries by `priority` in ascending order. It
discards the catalog array order, so moving an entry earlier in a generated JSON array does not move
it earlier in the picker. The implementation records this constraint directly in
`src/codex/catalog/sync.ts`.

opencodex therefore controls featured placement by assigning lower priorities, not by relying on
array position. Unless noted otherwise, the fixed priorities and worked example below describe a
catalog with no eligible Codex account selectors. With `N` eligible selectors, featured priorities
use `N` as a stride: a bare native choice at configured rank `i` expands to selector rows at
priorities `i * N + j`, where `j` is the selector's zero-based position; a routed choice uses
`i * N`; and an exact selector-qualified choice uses `i * N + j` for its selector. Unselected routed
rows are moved outside those selector groups. Codex still advertises only the first five
picker-visible rows.

Without a saved picker order, the relevant no-selector priorities are:

| Catalog entry | Priority | Source |
| --- | ---: | --- |
| `subagentModels[i]` | `i` (`0` through `4`) | The featured rank map in `src/codex/catalog/sync.ts` |
| Other routed models | `5` | Routed entry creation in `src/codex/catalog/sync.ts` |
| Native GPT slugs by default | `9` | Native entry creation in `src/codex/catalog/sync.ts` |
| Unselected native models while a featured list exists | At least `featured.length + 100` | Native catalog merge in `src/codex/catalog/sync.ts` |

The management API limits `subagentModels` to five entries with `slice(0, 5)` in
`src/server/management/agent-settings-routes.ts`. This matches the Codex `spawn_agent` surface, which
advertises only the first five model overrides. Models outside those five can still remain visible
in the main picker and callable by their exact id.

## How ties are ordered

All ordinary routed models have priority `5`, so they need a tie-breaker. Before catalog entries are
built, `gatherRoutedModels()` sorts the routed model list by provider name and then by model id, both
alphabetically (`src/codex/catalog/provider-fetch.ts`).

This means neither of these configuration details changes the final order:

- the declaration order of keys in the `providers` object;
- the order of ids in a provider's `models` array.

`orderForSubagents()` then uses a stable sort to move configured featured picks to the front in the
same order as `subagentModels`. Non-featured models keep the provider/id alphabetical relative order
established earlier (`src/codex/catalog/sync.ts`). The featured rank is also converted to
priorities `0` through `4` when entries are built, so Codex's priority sort preserves that leading
sequence.

## Visibility is separate from ordering

`selectedModels` and `disabledModels` decide which routed models are exposed; they are not ordering
controls. `filterCatalogVisibleModels()` converts both selections to `Set` lookups and filters the
gathered list without using the arrays as ranks (`src/codex/catalog/provider-fetch.ts`).

As a result, reordering `selectedModels` or `disabledModels` has no effect on picker position. It can
only change whether a model is included.

## Effective picker pattern

With no eligible account selectors and a non-empty featured list, the resulting order is:

1. Models in the exact configured `subagentModels` order, with priorities `0` through `4`.
2. All remaining routed models, ordered alphabetically by provider and then model id, at priority `5`.
3. Unselected native models, pushed below the featured block during catalog merge.

Without `subagentModels`, routed models remain at priority `5`, native GPT entries use their normal
priority (normally `9` for entries built by opencodex), and the routed group remains provider/id
alphabetical.

## Example

Suppose `subagentModels` contains these five ids in this exact order:

```toml
subagentModels = [
  "gpt-5.5",
  "opencode-go/glm-5.2",
  "anthropic/claude-opus-4-6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
]
```

The picker begins as follows:

| Picker position | Model | Priority | Why it appears there |
| ---: | --- | ---: | --- |
| 1 | `gpt-5.5` | `0` | First `subagentModels` selection |
| 2 | `opencode-go/glm-5.2` | `1` | Second selection, even though its provider sorts after `anthropic` |
| 3 | `anthropic/claude-opus-4-6` | `2` | Third selection |
| 4 | `gpt-5.6-sol` | `3` | Fourth selection |
| 5 | `gpt-5.6-terra` | `4` | Fifth selection |
| 6 | `anthropic/claude-fable-5` | `5` | First remaining routed id in provider/id alphabetical order |
| 7 onward | Remaining routed models | `5` | Provider alphabetically, then model id alphabetically |
| After routed models | Remaining native models | `featured.length + 100` or higher | Unselected natives are moved below the featured block |

The first five entries are the overrides advertised to `spawn_agent`; the rest continue in the
normal picker order. With account selectors, the five-entry limit applies after bare native choices
have expanded into selector-qualified groups.

## Changing the order

Use `subagentModels` to choose and order the leading models that Codex also advertises to
`spawn_agent`. The dashboard's **Sub-agents** page can reorder bare native and routed ids. Use
`ocx agent subagents set` or edit the opencodex configuration for exact
`<selector>/<native-openai-model>` choices; the dashboard retains those ids once saved, including choices currently unavailable. Use at most five configured ids. With account selectors, one bare native
choice can expand into multiple selector-qualified catalog rows, so configured choices and
advertised rows are not necessarily one-to-one.

If no configured account supports an account-gated native model, the request fails as an invalid
model choice. If supporting accounts exist but are temporarily exhausted or unavailable, it fails
as a retryable rate limit. These states are never reported as an invalid API key; choose another
available model or wait for the capable account's quota window to reopen.

Use `modelPickerOrder` to order **all available models**, including featured and native models.
Every nonempty list applies the same rule: listed ids come first in array order; unlisted rows
follow in their natural priority order. No native id is required to activate this behavior.

```json
{
  "modelPickerOrder": ["cursor/claude-opus-5-5", "gpt-6-astra", "google-antigravity/gemini-3.8-flash"]
}
```

Exact catalog ids take precedence over equivalent raw/encoded routed ids. Bare and
account-qualified ids are separate rows; include each exact selector id you want to position.
Hidden models stay hidden. An unset or empty order restores default priorities.

### Migration note: native ids in existing orders

Existing routed-only lists now override featured positions too. Listed models move ahead of
unlisted models. Clear the order with **Default** to restore natural ordering. Existing lists
containing native ids remain editable without resetting them first.

`modelPickerOrder` preserves the separate natural priority used by OpenCodex's subagent guidance.
It does not change `subagentModels` or fallback settings. Native Codex's five advertised
`spawn_agent` choices follow display priority and may therefore change; that advertised list is
not an allowlist for exact-name overrides. V1 receives no OpenCodex preferred-roster injection;
V2 can receive the separate natural-priority guidance when its catalog state permits.

## Dashboard ordering

On **Models**, choose **Custom order**. Drag any row, or use its Up/Down buttons, then choose
**Save draft**. Featured and native models can move anywhere; the Featured badge is informational.
Saved rows retain their relative order. Newly available models are appended without replacing
saved positions. Saving sends the complete available list without changing the featured roster.

**A–Z by model**, **Group by provider**, and **Most used snapshot** also include native models.
Choose **Apply order** to save a preset; choosing an option alone does not overwrite the saved
order. `modelPickerOrderMode` records preset provenance, not a continuously recomputed policy.
Most used reads retained usage once on Apply. **Default** clears order and mode.

`GET/PUT /api/subagent-models` uses the same visible model set for `pickerAvailable` and write
validation, including native, routed and bare alias rows. `chosen` and `available` separately
retain saved roster choices, including unavailable ones. Picker writes never send `models`.
Blank, duplicate or unavailable ids are rejected before persistence.

The editor requires complete routed identities and checks a fresh snapshot before saving.
Concurrent settings changes preserve the draft and require **Reload and discard draft**;
request failures retain it for retry. A successful save may still report a pending catalog
refresh. Reopen Codex if it holds an older in-memory catalog; saving does not restart it.
Claude discovery follows the saved order within routed groups; its native prefix and explicit
Desktop profile/alias ownership remain unchanged.
