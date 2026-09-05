import type { WorkspaceVisibleTabType } from '../../../shared/tab-types'
import type { PluginFocusedSurfaceKind } from '../../../shared/plugins/plugin-focused-surface'
import type { PluginUiFocusReport } from '../../../shared/plugins/plugin-focused-surface'

const COMMAND_PALETTE_MODALS = new Set(['worktree-palette', 'quick-open'])

export type PluginUiFocusViewState = {
  windowFocused: boolean
  activeModal?: string | null
  activeTabType?: WorkspaceVisibleTabType | null
  activeWorktreeId?: string | null
  unifiedTabsByWorktree?: Record<
    string,
    {
      id: string
      groupId: string
      label: string
      customLabel: string | null
      generatedLabel?: string | null
    }[]
  >
  groupsByWorktree?: Record<string, { id: string; activeTabId: string | null }[]>
  activeGroupIdByWorktree?: Record<string, string | undefined>
}

export function derivePluginUiFocusReport(state: PluginUiFocusViewState): PluginUiFocusReport {
  if (!state.windowFocused) {
    return { windowFocused: false }
  }
  if (state.activeModal && COMMAND_PALETTE_MODALS.has(state.activeModal)) {
    return { windowFocused: true, kind: 'command-palette', title: null }
  }
  const kind = kindFromVisibleTabType(state.activeTabType)
  if (!kind) {
    return { windowFocused: true }
  }
  return {
    windowFocused: true,
    kind,
    title: activeTabTitle(state)
  }
}

function kindFromVisibleTabType(
  type: WorkspaceVisibleTabType | null | undefined
): PluginFocusedSurfaceKind | null {
  if (!type) {
    return null
  }
  switch (type) {
    case 'terminal':
      return 'terminal'
    case 'editor':
      return 'editor'
    case 'agent-session':
      return 'agent'
    case 'browser':
      return 'browser'
    case 'simulator':
      return 'simulator'
  }
}

function activeTabTitle(state: PluginUiFocusViewState): string | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const groups = state.groupsByWorktree?.[worktreeId] ?? []
  const preferredGroupId = state.activeGroupIdByWorktree?.[worktreeId]
  const group =
    (preferredGroupId ? groups.find((entry) => entry.id === preferredGroupId) : null) ??
    groups[0] ??
    null
  if (!group?.activeTabId) {
    return null
  }
  const tab = (state.unifiedTabsByWorktree?.[worktreeId] ?? []).find(
    (entry) => entry.id === group.activeTabId
  )
  if (!tab) {
    return null
  }
  return tab.customLabel ?? tab.generatedLabel ?? tab.label ?? null
}
