# Plugin UI focus follow-up (join keys + `ui.readFocus`)

**Date:** 2026-09-05
**Status:** Follow-up to Orca-4 on `jondmarien/orca` `main`
**Tracks:** [jondmarien/orca-discord-presence#7](https://github.com/jondmarien/orca-discord-presence/issues/7) host checklist
**Context7:** skipped (in-repo plugin API; sidecar spike already noted quota)

## Goal

Close the host-side gaps between the landed Orca-4 surface (`ui:focus`,
`ui.focus.changed`, optional `focusedSurface` on `workspace.readContext`) and
issue #7’s Host / Orca dependencies checklist — without rewriting the consent
model or implementing Discord presence.

## What Orca-4 already shipped

- Opt-in capability `ui:focus` (re-consent on add)
- Event `ui.focus.changed` → `{ focusedSurface, receivedAt }`
- `workspace.readContext.focusedSurface` only when `ui:focus` is granted
- Privacy-truncated `{ kind, title }` (basename / hostname, 80 UTF-8 bytes)
- UI machine samples; local IPC + `plugins.reportUiFocus` RPC to the host
- Docs in `docs/reference/plugin-ui-focus.md`

## Gaps vs #7

| Checklist item | Orca-4 | This follow-up |
|---|---|---|
| Event fields `kind`, `title?`, `worktreeId?`, `agentId?` | `kind` + `title` only | Add optional join keys on the **surface** |
| Pollable `ui.readFocus` / `focusedSurface` | `focusedSurface` only | Add `ui.readFocus` (pluginApi 1.2) |
| Remote UI: where focus is sampled | Implemented; lightly documented | Document UI→host path; test RPC report + projection |
| Privacy docs | Partial | Expand payload schema, debounce, remote, #7 link |

## Approaches

### A — Raw `worktreeId` + `paneKey` as `agentId` on the public surface (recommended)

Extend `PluginFocusedSurface` with optional `worktreeId` and `agentId`. Values
are the **same identifiers already published** on `worktree.*` and
`agent.status.changed` (`worktreeId`, `paneKey` prefix / tab id). Title
sanitization stays. No filesystem `path` field.

- Pros: plugins can join focus to agent status without a racey `readContext`
  poll; matches #7 literally; still gated by `ui:focus`
- Cons: Orca worktree ids embed provider paths. Mitigate by documenting them
  as opaque join keys (never display), keeping titles sanitized, and not
  adding `path` to this surface. `workspace.readContext` still omits
  top-level `worktreeId` (Orca-3 privacy)

### B — Hash the ids so `ui:focus` cannot leak a path (rejected)

A hash would not join to `agent.status.changed.worktreeId` / `paneKey`.
Presence plugins that already subscribe to those events already see the raw
ids; hashing only on focus makes the new fields useless.

### C — Document-only “call `readContext` after the event” (rejected)

#7 asked for fields on the event (or a poll). `readContext` still has no
worktree join key. This would leave the checklist open.

## Design

### Public projection (additive)

```ts
type PluginFocusedSurface = {
  kind: 'terminal' | 'agent' | 'browser' | 'editor' | 'simulator' | 'command-palette'
  title: string | null
  worktreeId?: string | null  // same join key as worktree.* / agent.status.changed
  agentId?: string | null     // focused agent-session tab id; join paneKey via `${agentId}:`
}
```

- `title` — unchanged sanitizer (basename / http hostname / 80 bytes)
- `worktreeId` — host worktree id when the UI knows the active worktree; omit
  or `null` when unknown. Plugins must treat it as opaque
- `agentId` — present only when `kind === 'agent'`; the unified tab id (UUID).
  `agent.status.changed.paneKey` is `${tabId}:${leafId}`; join with prefix
- Event envelope stays `{ focusedSurface, receivedAt }` (strict; no extra keys)
- Equality includes the new fields so a worktree/agent switch emits

### Incoming UI report

Renderer (and remote RPC) may send optional `worktreeId` / `agentId` alongside
`windowFocused` / `kind` / `title`. The host re-projects; clients never skip
sanitization.

### `ui.readFocus` (pluginApi 1.2)

| | |
|---|---|
| Params | `{}` optional |
| Result | `{ focusedSurface: PluginFocusedSurface \| null }` |
| Capability | `ui:focus` |
| Scope | `ui-focus` |
| Panel | yes |
| Mutation | no |

Admission is the existing gate: missing consent → `consent_required`; missing
capability → `capability_denied`. No second channel around `ui:focus`.

### Remote UI path (normative)

Focus is sampled on the **UI machine** (paired Electron renderer). Plugin
workers run on the **runtime host**.

```
UI renderer
  → plugins:reportUiFocus IPC          (local host / local Electron)
  → plugins.reportUiFocus runtime RPC  (paired client → runtime host)
       → PluginUiFocusSnapshot.apply   (host re-projects)
       → ui.focus.changed              (workers on the host)
       → workspace.readContext / ui.readFocus
```

- New RPC method; no `RUNTIME_PROTOCOL_VERSION` bump (Rule 1 / “do not bump
  for new methods”)
- Older hosts reject the call; the client ignores that
- Loss of contact is not evidence the UI closed a surface → `null`
- Sidecar / Discord-on-another-box is a **separate** hop (Orca-5); this PR
  only gets focus onto the host where plugins run

### Debounce (consumer contract)

- Renderer coalesces reports (~100ms)
- Host emits `ui.focus.changed` only when the **projected** snapshot changes
- Consumers (Discord SET_ACTIVITY ~15s) must still coalesce
- Missing/`null` focus must not clear other presence

### Out of scope

- Discord activity / chron0.discord-presence
- Breaking or removing `ui:focus`
- Top-level `worktreeId` on `workspace.readContext`
- Pixel-perfect OS focus outside Orca
