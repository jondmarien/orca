# Host-Mediated Remote Presence Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Orca-5 host mailbox + `sidecar` pluginApi 1 methods + `sidecar.clientHost.latest` pull hook, with placement semantics and tests, without speaking Discord IPC or deleting companion concepts.

**Architecture:** Shared contract (`plugin-sidecar-contract.ts`) is the single schema. `PluginSidecarMailbox` is process-local last-frame storage owned by `PluginService`. Worker host methods publish/resolve through that mailbox. Paired Electron clients advertise `sidecar.clientHost.v1` and pull frames over a new optional runtime RPC. A UI-machine apply stub is the documented Discord IPC insertion point.

**Tech Stack:** TypeScript, zod, vitest, existing plugin host API table, runtime RPC `defineMethod`.

## Global Constraints

- Additive only inside `pluginApi` major 1 (`since: '1.1'`); no `RUNTIME_PROTOCOL_VERSION` bump.
- New optional capability / RPC method only; no new terminal stream opcode.
- Do not open a PR against `stablyai/orca`.
- Do not implement Discord IPC or delete companion concepts.
- Follow `AGENTS.md`: no `helpers`/`utils` filenames; no `max-lines` disables; SSH/folder/remote-wire considered.
- Context7 quota was exceeded; rely on in-repo architecture docs.

## File structure

- Create: `src/shared/plugins/plugin-sidecar-contract.ts` — schemas, constants, types
- Create: `src/shared/plugins/plugin-sidecar-contract.test.ts`
- Create: `src/main/plugins/plugin-sidecar-mailbox.ts`
- Create: `src/main/plugins/plugin-sidecar-mailbox.test.ts`
- Create: `src/main/plugins/plugin-sidecar-ui-executor.ts`
- Create: `src/main/plugins/plugin-sidecar-ui-executor.test.ts`
- Create: `src/main/runtime/rpc/methods/sidecar-client-host.ts`
- Create: `src/main/runtime/rpc/methods/sidecar-client-host.test.ts`
- Create: `docs/reference/plugin-sidecar-remote-presence.md`
- Modify: `src/shared/plugins/plugin-capabilities.ts`
- Modify: `src/shared/plugins/plugin-host-api.ts`
- Modify: `src/shared/protocol-version.ts`
- Modify: `src/main/plugins/plugin-host-method-bindings.ts`
- Modify: `src/main/plugins/plugin-host-service-bindings.ts`
- Modify: `src/main/plugins/plugin-host-methods.ts` (`summarizeParams`)
- Modify: `src/main/plugins/plugin-service.ts`
- Modify: `src/main/plugins/plugin-host-methods.test.ts`
- Modify: `src/main/plugins/plugin-host-conformance.test.ts`
- Modify: `src/main/runtime/rpc/methods/index.ts`
- Modify: `src/renderer/src/components/settings/plugin-capability-presentation.ts`
- Modify: `src/renderer/src/i18n/locales/en.json`
- Modify: `docs/reference/remote-wire-compatibility.md`

---

### Task 1: Shared sidecar contract

**Files:**
- Create: `src/shared/plugins/plugin-sidecar-contract.ts`
- Test: `src/shared/plugins/plugin-sidecar-contract.test.ts`

**Interfaces:**
- Produces: `PLUGIN_SIDECAR_PAYLOAD_MAX_BYTES`, `PLUGIN_SIDECAR_MAILBOX_SLOT_LIMIT`, `sidecarPublishParamsSchema`, `sidecarPlacementSchema`, `sidecarPublishResultSchema`, `sidecarStoredFrameSchema`, `buildSidecarPlacement(lastPublishedAt)`

- [ ] **Step 1: Write the failing contract test**

```ts
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_SIDECAR_PAYLOAD_MAX_BYTES,
  sidecarPublishParamsSchema,
  buildSidecarPlacement
} from './plugin-sidecar-contract'

describe('plugin sidecar contract', () => {
  it('requires payload on set and forbids it on clear', () => {
    expect(sidecarPublishParamsSchema.safeParse({ channel: 'presence', op: 'set' }).success).toBe(
      false
    )
    expect(
      sidecarPublishParamsSchema.safeParse({ channel: 'presence', op: 'clear', payload: { a: 1 } })
        .success
    ).toBe(false)
    expect(
      sidecarPublishParamsSchema.safeParse({
        channel: 'presence',
        op: 'set',
        payload: { details: 'Working in Orca' }
      }).success
    ).toBe(true)
  })

  it('rejects a payload whose JSON exceeds the byte cap', () => {
    expect(
      sidecarPublishParamsSchema.safeParse({
        channel: 'generic',
        op: 'set',
        payload: 'x'.repeat(PLUGIN_SIDECAR_PAYLOAD_MAX_BYTES + 1)
      }).success
    ).toBe(false)
  })

  it('reports host-only plugin process and Discord-on-UI-machine IPC', () => {
    expect(buildSidecarPlacement(null)).toMatchObject({
      pluginProcess: 'runtime-host',
      discordIpcMustRun: 'machine-with-discord',
      hostForwards: 'sidecar-frames',
      companionStillValid: true,
      lastPublishedAt: null
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/shared/plugins/plugin-sidecar-contract.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the contract**

Export zod schemas and `buildSidecarPlacement`. Use `isUtf8ByteLengthWithinLimit` from `src/shared/utf8-byte-limits.ts` on `JSON.stringify(payload)`. `since` is not in this file; host API rows use `'1.1'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/shared/plugins/plugin-sidecar-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/plugins/plugin-sidecar-contract.ts src/shared/plugins/plugin-sidecar-contract.test.ts
git commit -m "feat(plugins): add sidecar presence contract schemas"
```

---

### Task 2: Mailbox + UI executor stub

**Files:**
- Create: `src/main/plugins/plugin-sidecar-mailbox.ts`
- Create: `src/main/plugins/plugin-sidecar-mailbox.test.ts`
- Create: `src/main/plugins/plugin-sidecar-ui-executor.ts`
- Create: `src/main/plugins/plugin-sidecar-ui-executor.test.ts`

**Interfaces:**
- Consumes: contract schemas / `buildSidecarPlacement`
- Produces: `PluginSidecarMailbox.publish/latest/resolvePlacement`, `applySidecarFrameOnUiMachine`

- [ ] **Step 1: Write failing mailbox and executor tests**

Mailbox: per-plugin isolation, set replaces, clear stores `op: 'clear'`, `latest(pluginKey)` filters, slot limit evicts oldest.
Executor: set stores frame; clear removes it; result `discordIpc` is `'not-implemented'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/main/plugins/plugin-sidecar-mailbox.test.ts src/main/plugins/plugin-sidecar-ui-executor.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement mailbox and executor**

`PluginSidecarMailbox` is in-memory. Key = `pluginKey + '\0' + channel`. `publish` returns `{ accepted: true, delivery: 'stored', placement }`. Executor keeps a `Map` for tests / future Electron wiring.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/plugins/plugin-sidecar-mailbox.ts src/main/plugins/plugin-sidecar-mailbox.test.ts src/main/plugins/plugin-sidecar-ui-executor.ts src/main/plugins/plugin-sidecar-ui-executor.test.ts
git commit -m "feat(plugins): add sidecar mailbox and UI-machine apply stub"
```

---

### Task 3: pluginApi 1 capability and host methods

**Files:**
- Modify: `src/shared/plugins/plugin-capabilities.ts`
- Modify: `src/shared/plugins/plugin-host-api.ts`
- Modify: `src/main/plugins/plugin-host-method-bindings.ts`
- Modify: `src/main/plugins/plugin-host-service-bindings.ts`
- Modify: `src/main/plugins/plugin-host-methods.ts`
- Modify: `src/main/plugins/plugin-service.ts`
- Modify: `src/main/plugins/plugin-host-methods.test.ts`
- Modify: `src/main/plugins/plugin-host-conformance.test.ts`
- Modify: `src/renderer/src/components/settings/plugin-capability-presentation.ts`
- Modify: `src/renderer/src/i18n/locales/en.json`

**Interfaces:**
- Consumes: `PluginSidecarMailbox`, contract schemas
- Produces: `sidecar.resolvePlacement`, `sidecar.publish` on `PLUGIN_HOST_API_V0`; `PluginHostServices.sidecar`

- [ ] **Step 1: Write failing host-method tests**

Add cases to `plugin-host-methods.test.ts`: granted publish stores via services; missing capability denied; panel call is `panel_forbidden`.
Update conformance `successParams` and length **15**.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/main/plugins/plugin-host-methods.test.ts src/main/plugins/plugin-host-conformance.test.ts`
Expected: FAIL — unknown method / length 13

- [ ] **Step 3: Wire capability, specs, handlers, bindings, PluginService mailbox**

`PluginService` owns `readonly sidecarMailbox = new PluginSidecarMailbox()` and passes it into `bindPluginHostServices`. Optional `sidecarMailbox` argument defaults to a fresh mailbox so existing bind call sites keep compiling. `summarizeParams` for `sidecar.publish` is `channel=… op=…` (no payload bytes content).

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/plugins/plugin-capabilities.ts src/shared/plugins/plugin-host-api.ts src/main/plugins/plugin-host-method-bindings.ts src/main/plugins/plugin-host-service-bindings.ts src/main/plugins/plugin-host-methods.ts src/main/plugins/plugin-service.ts src/main/plugins/plugin-host-methods.test.ts src/main/plugins/plugin-host-conformance.test.ts src/renderer/src/components/settings/plugin-capability-presentation.ts src/renderer/src/i18n/locales/en.json
git commit -m "feat(plugins): add sidecar.resolvePlacement and sidecar.publish host API"
```

---

### Task 4: Runtime capability + clientHost.latest RPC

**Files:**
- Modify: `src/shared/protocol-version.ts`
- Create: `src/main/runtime/rpc/methods/sidecar-client-host.ts`
- Create: `src/main/runtime/rpc/methods/sidecar-client-host.test.ts`
- Modify: `src/main/runtime/rpc/methods/index.ts`

**Interfaces:**
- Consumes: `requirePluginService()`-style injection via existing `setPluginServiceForRpc` / `PluginService.sidecarMailbox`
- Produces: `SIDECAR_CLIENT_HOST_RUNTIME_CAPABILITY`, `sidecar.clientHost.latest`

- [ ] **Step 1: Write failing RPC tests**

Empty mailbox → `{ frames: [] }`. After `mailbox.publish`, `latest` returns the frame. `clientCapabilities: []` throws. `clientCapabilities` including `sidecar.clientHost.v1` succeeds. `pluginKey` filter works. `ALL_RPC_METHODS` contains the name. `RUNTIME_CAPABILITIES` and `ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES` contain the cap. Cap is **not** in `NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/runtime/rpc/methods/sidecar-client-host.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement capability constant, RPC method, register in `ALL_RPC_METHODS`**

Refuse when `clientCapabilities` is provided and omits the cap. Do not add to the mobile allowlist.

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/protocol-version.ts src/main/runtime/rpc/methods/sidecar-client-host.ts src/main/runtime/rpc/methods/sidecar-client-host.test.ts src/main/runtime/rpc/methods/index.ts
git commit -m "feat(runtime): add sidecar.clientHost.latest pull RPC"
```

---

### Task 5: Semantics docs

**Files:**
- Create: `docs/reference/plugin-sidecar-remote-presence.md`
- Modify: `docs/reference/remote-wire-compatibility.md` (see-also + Rule 3 note)

- [ ] **Step 1: Write the semantics doc** covering Windows UI → Linux host, what is forwarded, companion complementarity, follow-ups.

- [ ] **Step 2: Link it from `remote-wire-compatibility.md`.**

- [ ] **Step 3: Commit**

```bash
git add docs/reference/plugin-sidecar-remote-presence.md docs/reference/remote-wire-compatibility.md docs/superpowers
git commit -m "docs: record remote presence sidecar placement semantics"
```

---

## Spec coverage

| Spec requirement | Task |
|---|---|
| Placement semantics | 1, 5 |
| `sidecar` capability + host methods | 3 |
| Mailbox / stored delivery | 2, 3 |
| Client pull RPC + capability | 4 |
| UI executor stub | 2 |
| Companion remains valid | 1, 5 |
| Tests | 1–4 |
| Additive pluginApi 1 / no opcode | 3, 4 |

## Type consistency

- Methods: `sidecar.resolvePlacement`, `sidecar.publish`
- RPC: `sidecar.clientHost.latest`
- Capability kind: `sidecar`
- Runtime cap: `sidecar.clientHost.v1`
- Delivery: `'stored'`
- Discord IPC stub: `'not-implemented'`
