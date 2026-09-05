# Host-mediated remote presence / sidecar hook

**Date:** 2026-09-05
**Status:** Spike design for Orca-5 ([jondmarien/orca-discord-presence#10](https://github.com/jondmarien/orca-discord-presence/issues/10) §2.D)
**Context7:** quota exceeded; architecture taken from in-repo remote-UI / plugin docs.

## Goal

Give a plugin that already runs on the **runtime host** a host-mediated way to
publish a generic sidecar frame (Discord presence is the first consumer) so a
**paired UI machine** can apply it — without requiring every user to run the
plugin HTTP companion forever.

This PR lands the smallest honest host-side path: placement semantics, a
pluginApi 1 `sidecar` capability, a host mailbox, and a capability-gated
client pull RPC. It does **not** speak Discord IPC in Orca core and does
**not** delete companion concepts.

## Spike findings (remote UI today)

Confirmed against `stablyai/orca` `main` after merge:

| Fact | Where |
|---|---|
| Plugins run on the **runtime host**, not the paired UI | `PluginService` forks `plugin-host-entry.js` on the host; `orca serve` still calls `initializeMainProcessPlugins()` |
| Discord IPC **must** run on the machine that has Discord / Vesktop | OS IPC (Win32 named pipes, POSIX sockets). A Linux host cannot open the Windows Discord pipe |
| Paired client ↔ host already have an authenticated runtime RPC | `docs/reference/remote-wire-compatibility.md`; `RUNTIME_PROTOCOL_VERSION = 3` |
| Best existing “host owns work, UI machine executes” pattern | `browser.clientHost.*` (capability + lease + RPC). Too large to copy wholesale |
| Best existing “host publishes, clients observe” pattern | `notifications.subscribe` stream |
| Computer sidecar is **host-local** | `src/main/computer/sidecar-client.ts` — wrong machine for Discord-on-UI |
| Desktop renderer still talks to **local** `window.api.plugins.*` | Host already exposes `plugins.*` RPC; renderer routing to the active remote environment is a separate gap |
| SSH relay does **not** run Orca plugins | `registerRelayPluginHostCallHandlers(..., () => null)` — out of scope |
| No Discord / presence code exists in Orca | Greenfield on the plugin host API |

Companion MVP (plugin PR #6) stays valid: opt-in HTTP from the host plugin to a
small Discord-IPC process on the UI machine. Native mediation complements it.

## Approaches

### A — Full UI-machine Discord IPC + clientHost lease (rejected for this PR)

Copy `browser.clientHost`: lease, attach, push stream, Electron-side Discord
handshake, named pipes / sockets, reconnect. Product-complete, but it is a
multi-PR subsystem (protocol, privacy, platform IPC, executor lifecycle). Too
large for one honest PR, and it would bake Discord into Orca core.

### B — Additive `sidecar` capability + host mailbox + client pull (recommended)

One new plugin capability and two worker-only host methods. The host stores the
last frame per plugin+channel. A paired Electron client that advertises
`sidecar.clientHost.v1` pulls frames over existing runtime RPC. A documented
UI-machine executor stub is the insertion point for a later Discord IPC writer.

This is a real host-mediated path: the plugin stops needing a second HTTP
server once a client executor exists. Until that executor speaks Discord, the
companion remains the working dual-host transport.

### C — Piggyback `notifications.show` or plugin events (rejected)

Wrong shape, wrong privacy copy, and Rule 3: changing what the host publishes
on an existing path reaches old clients with no wire change. Sidecar frames are
not toasts.

## Design

### Placement semantics (normative)

The host **cannot** know whether Discord is installed on the host, the UI
machine, or both. Placement reports only facts the host can stand behind:

| Field | Value | Meaning |
|---|---|---|
| `pluginProcess` | `runtime-host` | Workers and host API execution live on the runtime host |
| `discordIpcMustRun` | `machine-with-discord` | Discord IPC is OS-local; never implied to be the host |
| `hostForwards` | `sidecar-frames` | JSON snapshots via the mailbox + `sidecar.clientHost.latest` |
| `hostDoesNotForward` | `discord-ipc-bytes`, `companion-http` | Raw Discord protocol and the plugin companion stay out of band |
| `mailboxAvailable` | `true` on this build | `sidecar.publish` stores a frame |
| `companionStillValid` | `true` | HTTP companion remains the supported fallback |
| `lastPublishedAt` | `number \| null` | Host clock ms of the last successful publish for **this** plugin |

Plugin decision tree (documented, not enforced):

1. Keep trying **local** Discord IPC (today’s colocated path).
2. Call `sidecar.publish` so a paired UI executor can apply the same frame.
3. If local IPC failed and no client executor is running, keep the **companion**.

### pluginApi 1 (additive)

New capability kind: `sidecar`.

Consent copy: “Publish sidecar frames (for example Discord presence) so a paired
UI client can apply them on the machine that has Discord.”

New worker-only methods (`panel: false`, `since: '1.1'`, scope `sidecar`):

- `sidecar.resolvePlacement` → placement object (no mutation)
- `sidecar.publish` `{ channel: 'presence' \| 'generic', op: 'set' \| 'clear', payload? }` → `{ accepted: true, delivery: 'stored', placement }`

`set` requires `payload` (JSON, ≤ 8192 UTF-8 bytes of `JSON.stringify`).
`clear` forbids `payload`. Mutation is audit-logged (`channel=… op=…`).

Old plugins that do not declare `sidecar` are unchanged. Consent fingerprint
changes only when a plugin adds the kind.

### Host mailbox

In-memory, process-local, last frame per `pluginKey + channel`. Cap 256 slots;
evict the oldest `publishedAt`. Shared by `PluginService` host calls and the
runtime RPC so a publish is visible to paired clients.

### Runtime wire

New optional capability `sidecar.clientHost.v1`:

- Host advertises it in `RUNTIME_CAPABILITIES` (mailbox RPC exists).
- Electron paired clients advertise it in `ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES`.
- Not added to generic `remoteRuntimeClientCapabilities()` (CLI) or the mobile allowlist.

New RPC `sidecar.clientHost.latest` `{ pluginKey?: string }` → `{ frames }`.
If `clientCapabilities` is present, the method refuses callers that omitted
`sidecar.clientHost.v1`. No new stream opcode. No `RUNTIME_PROTOCOL_VERSION`
bump (new method + new capability string).

### UI-machine prototype hook

`applySidecarFrameOnUiMachine(frame)` stores the last frame and returns
`discordIpc: 'not-implemented'`. This is the documented insertion point for a
later Discord IPC writer. This PR does not poll, does not fork a companion, and
does not open Discord pipes.

### Out of scope

- Orca-1…4 (panel settings/storage, richer `readContext`, focus)
- Renderer `window.api.plugins.*` routing to a remote active environment
- Speaking Discord IPC in Orca
- Deleting or rewriting the chron0 companion
- Upstream PR against `stablyai/orca`
- SSH relay plugin runtime

## Testing

- Contract: placement constants, publish schema, byte cap, set/clear rules
- Mailbox: isolation, replace, clear, slot eviction
- Host API: grant/deny, panel_forbidden, audit summary, conformance on both transports
- RPC: empty mailbox, post-publish pull, capability refusal, pluginKey filter
- UI executor stub: set stores, clear clears, does not claim Discord IPC
- Capability lists include `sidecar.clientHost.v1` on host and Electron clients

## Follow-ups

1. Electron client Discord IPC executor that pulls (or later subscribes) and speaks Discord.
2. `sidecar.clientHost.subscribe` push stream, negotiated like `notifications.subscribe`.
3. Route desktop plugin IPC to the active remote runtime (existing gap).
4. `chron0.discord-presence`: prefer mailbox when a client executor is present; keep companion as fallback.
5. Optional `capableClientCount` once clients attach a lease.

## Self-review

- No placeholders: delivery is `stored`; Discord IPC is explicitly `not-implemented`.
- Companion is complemented, not replaced.
- Additive pluginApi 1; mixed remotes ignore an unknown RPC method and an unknown capability string.
