# Plugin UI focus (`ui:focus`)

How plugins learn which Orca surface is focused, what is redacted, and where the sample is taken. Feeds the optional focused-surface product in [chron0.discord-presence#7](https://github.com/jondmarien/orca-discord-presence/issues/7) without implementing that plugin.

This surface is **experimental** and **additive inside `pluginApi` 1**. It is **off by default**: a plugin does not receive focus data unless the user consents to the `ui:focus` capability.

## Why a capability

Tab titles, file names, and page URLs are identifying. `workspace:read` already exposes the focused worktree's display name, branch, and terminal **ids** — not which pane is active. Event subscriptions do not re-fingerprint consent, so adding `ui.focus.changed` to the allowlist alone would leak titles to any already-approved `events:subscribe` plugin.

`ui:focus` is the opt-in. Installing or updating a plugin that declares it re-prompts consent.

## What plugins receive

One privacy-safe projection, delivered two ways:

```ts
type PluginFocusedSurface = {
  kind: 'terminal' | 'agent' | 'browser' | 'editor' | 'simulator' | 'command-palette'
  title: string | null
}
```

- **`workspace.readContext`** includes `focusedSurface` only when the caller has `ui:focus`. The field is omitted otherwise (old plugins see today's `{ branch, displayName, terminals }` shape). Value is `null` when focus is unknown or the Orca window is unfocused.
- **`ui.focus.changed`** delivers `{ focusedSurface, receivedAt }` to workers that subscribed (manifest or `events.subscribe`) **and** have `ui:focus`. Manifests that list the event without the capability fail validation.

`title` is never a filesystem path or a full URL: path-like values become a basename, `http(s)` titles become a hostname, and the host then truncates to 80 UTF-8 bytes. There is no `worktreeId` (those ids embed provider paths) and no agent/model fields (Orca-3).

## Default off

| Gate                             | Effect                                                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| User did not grant `ui:focus`    | `focusedSurface` omitted from `readContext`; `ui.focus.changed` is not delivered; `events.subscribe` drops that name                   |
| Window unfocused / no sample yet | `focusedSurface: null` (event) or omitted/`null` (readContext). Missing focus must not clear other presence — that is the plugin's job |
| Plugin toggle / detail level     | Host does not interpret Discord detail levels. Plugins must keep their own default-off display toggle                                  |

## Where focus is sampled

Focus lives on the **UI machine**. Plugin workers run on the **Orca host** (including `orca serve` and SSH workspaces — plugins still execute on the computer running the host).

| Topology                         | Who samples                                                                               | How it reaches the host                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local Electron                   | Renderer (tab type, active tab label, Cmd+J / Quick Open) plus main `browser-window-blur` | `plugins:reportUiFocus` IPC                                                                                                      |
| Remote UI (paired client → host) | The UI client's renderer                                                                  | `plugins.reportUiFocus` runtime RPC (new method; no protocol-version bump). Older hosts reject the call; the client ignores that |
| Headless host, no UI             | Nobody                                                                                    | Snapshot stays `null` until a paired client reports                                                                              |

Loss of contact is not evidence the UI closed a surface. An unreported or unverifiable focus is `null`, not a guessed kind.

The host re-projects every report. Renderers may send a raw title; the snapshot stored for plugins is always the sanitized form.

## Plugin author notes

```js
// orca-plugin.json
{
  "pluginApi": 1,
  "capabilities": [
    { "kind": "workspace:read" },
    { "kind": "events:subscribe" },
    { "kind": "ui:focus" }
  ],
  "contributes": {
    "events": [{ "on": "ui.focus.changed" }]
  }
}
```

```js
orca.events.on('ui.focus.changed', (payload) => {
  // payload.focusedSurface is { kind, title } or null
})

const context = await orca.host.call('workspace.readContext', {})
// context.focusedSurface is present only with ui:focus
```

Events fire only when the projected snapshot changes. Call `workspace.readContext` after subscribe to seed. Treat `focusedSurface` as optional on older hosts. Coalesce rapid events (Discord SET_ACTIVITY is ~15s); the host already dedupes identical snapshots and the renderer debounces reports (~100ms). Missing/`null` focus must not clear other presence.

Related: [orca-discord-presence#10](https://github.com/jondmarien/orca-discord-presence/issues/10) Orca-4, [remote-wire-compatibility.md](./remote-wire-compatibility.md), [ssh-execution-boundary.md](./ssh-execution-boundary.md).
