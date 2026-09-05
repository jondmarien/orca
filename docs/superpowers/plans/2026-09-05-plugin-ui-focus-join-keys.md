# Plugin UI Focus Join Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Orca-4 `ui:focus` with privacy-safe `worktreeId` / `agentId` join keys, pollable `ui.readFocus`, remote-UI docs, and admission tests so issue #7’s host checklist is unblocked.

**Architecture:** Keep the existing snapshot + event + `focusedSurface` path. Project optional join keys in `plugin-focused-surface.ts`, sample them in the renderer report, add one host method bound to `ui:focus`, and document the UI-machine → runtime-host RPC hop.

**Tech Stack:** TypeScript, Zod, Vitest, existing plugin host API table / IPC / runtime RPC.

## Global Constraints

- Additive only inside `pluginApi` major 1 (`ui.readFocus` `since: '1.2'`).
- `ui:focus` stays opt-in; no consent-model rewrite.
- Titles stay basename/hostname + 80 UTF-8 bytes; no `path` on the surface.
- `workspace.readContext` still omits top-level `worktreeId`.
- New RPC method does not bump `RUNTIME_PROTOCOL_VERSION`.
- Do not open a PR against `stablyai/orca`.

---

### Task 1: Surface schema and projection

**Files:**
- Modify: `src/shared/plugins/plugin-focused-surface.ts`
- Test: `src/shared/plugins/plugin-focused-surface.test.ts`
- Modify: `src/main/plugins/plugin-ui-focus.ts` (equality via shared helper)
- Test: `src/main/plugins/plugin-ui-focus.test.ts`

**Interfaces:**
- Produces: `PluginFocusedSurface` with optional `worktreeId` / `agentId`; `projectPluginFocusJoinId`; equality includes join keys

- [ ] Write failing tests for join-key projection, equality, and `path` still rejected
- [ ] Implement projection
- [ ] Tests pass

### Task 2: Renderer report includes join keys

**Files:**
- Modify: `src/renderer/src/lib/plugin-ui-focus-report.ts`
- Test: `src/renderer/src/lib/plugin-ui-focus-report.test.ts`

**Interfaces:**
- Consumes: `projectPluginFocusJoinId` contract (ids passed raw; host projects)
- Produces: report `{ windowFocused, kind?, title?, worktreeId?, agentId? }`

- [ ] Write failing tests (active worktree + agent tab id)
- [ ] Implement
- [ ] Tests pass

### Task 3: `ui.readFocus` host method + admission

**Files:**
- Modify: `src/shared/plugins/plugin-host-api.ts`
- Modify: `src/main/plugins/plugin-host-method-bindings.ts`
- Test: `src/shared/plugins/plugin-host-api.test.ts`
- Test: `src/main/plugins/plugin-host-methods.test.ts`
- Test: `src/main/plugins/plugin-host-conformance.test.ts`

**Interfaces:**
- Produces: `ui.readFocus` → `{ focusedSurface }` gated by `ui:focus`

- [ ] Write failing tests (grant / deny / panel / 16 methods)
- [ ] Bind handler
- [ ] Tests pass

### Task 4: Remote report path

**Files:**
- Test: `src/main/plugins/plugin-service-host-calls` coverage via new test or `src/main/runtime/rpc/methods/plugins.test.ts`
- Modify: `src/preload/api/plugin-host-api.ts` (report payload types)

- [ ] Write failing tests that RPC/host apply projects join keys and emits once
- [ ] Extend report types
- [ ] Tests pass

### Task 5: Docs + consent copy

**Files:**
- Modify: `docs/reference/plugin-ui-focus.md`
- Modify: `docs/reference/remote-wire-compatibility.md`
- Modify: `docs/reference/plugin-panel-host-api.md`
- Modify: `src/shared/plugins/plugin-capabilities.ts`
- Modify: locales + `plugin-capability-presentation.ts`

- [ ] Expand payload, privacy, remote path, debounce, #7 mapping
- [ ] Update consent strings

---
