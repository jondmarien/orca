import { describe, expect, it } from 'vitest'
import {
  PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES,
  pluginFocusedSurfaceSchema,
  pluginUiFocusChangedPayloadSchema,
  projectPluginFocusedTitle,
  projectPluginUiFocusReport,
  pluginFocusedSurfacesEqual
} from './plugin-focused-surface'

describe('projectPluginFocusedTitle', () => {
  it('returns null for empty or whitespace titles', () => {
    expect(projectPluginFocusedTitle(null)).toBeNull()
    expect(projectPluginFocusedTitle('')).toBeNull()
    expect(projectPluginFocusedTitle('   ')).toBeNull()
  })

  it('keeps a short tab label', () => {
    expect(projectPluginFocusedTitle('Terminal 1')).toBe('Terminal 1')
  })

  it('projects path-like titles to a basename', () => {
    expect(projectPluginFocusedTitle('/Users/private/repo/src/main.ts')).toBe('main.ts')
    expect(projectPluginFocusedTitle('C:\\Users\\private\\repo\\README.md')).toBe('README.md')
  })

  it('projects http(s) titles to a hostname', () => {
    expect(projectPluginFocusedTitle('https://example.com/secret/path?token=1')).toBe('example.com')
  })

  it('truncates to the privacy byte budget', () => {
    const title = 'a'.repeat(PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES + 20)
    const projected = projectPluginFocusedTitle(title)
    expect(projected).toHaveLength(PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES)
  })
})

describe('projectPluginUiFocusReport', () => {
  it('returns null when the window is unfocused or kind is missing', () => {
    expect(projectPluginUiFocusReport({ windowFocused: false, kind: 'terminal' })).toBeNull()
    expect(projectPluginUiFocusReport({ windowFocused: true })).toBeNull()
    expect(projectPluginUiFocusReport({ unexpected: true })).toBeNull()
  })

  it('projects a focused surface and sanitizes the title', () => {
    expect(
      projectPluginUiFocusReport({
        windowFocused: true,
        kind: 'editor',
        title: '/tmp/identifying/file.ts'
      })
    ).toEqual({ kind: 'editor', title: 'file.ts' })
  })
})

describe('plugin focus schemas', () => {
  it('rejects extra keys and oversize titles on the public projection', () => {
    expect(
      pluginFocusedSurfaceSchema.safeParse({
        kind: 'terminal',
        title: 'ok',
        path: '/secret'
      }).success
    ).toBe(false)
    expect(
      pluginUiFocusChangedPayloadSchema.safeParse({
        focusedSurface: { kind: 'agent', title: null },
        receivedAt: Date.now(),
        worktreeId: '/Users/private/repo'
      }).success
    ).toBe(false)
  })
})

describe('pluginFocusedSurfacesEqual', () => {
  it('treats identical projections as unchanged', () => {
    const surface = { kind: 'browser' as const, title: 'example.com' }
    expect(pluginFocusedSurfacesEqual(surface, { ...surface })).toBe(true)
    expect(pluginFocusedSurfacesEqual(surface, { kind: 'browser', title: 'other.com' })).toBe(false)
    expect(pluginFocusedSurfacesEqual(null, null)).toBe(true)
  })
})
