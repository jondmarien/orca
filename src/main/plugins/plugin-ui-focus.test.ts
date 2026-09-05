import { describe, expect, it } from 'vitest'
import { PluginUiFocusSnapshot } from './plugin-ui-focus'

describe('PluginUiFocusSnapshot', () => {
  it('starts unknown and ignores duplicate reports', () => {
    const snapshot = new PluginUiFocusSnapshot()
    expect(snapshot.get()).toBeNull()

    const first = snapshot.apply({ windowFocused: true, kind: 'terminal', title: 'zsh' })
    expect(first).toEqual({
      changed: true,
      surface: { kind: 'terminal', title: 'zsh' }
    })
    expect(snapshot.apply({ windowFocused: true, kind: 'terminal', title: 'zsh' }).changed).toBe(
      false
    )
  })

  it('clears on window blur and sanitizes titles', () => {
    const snapshot = new PluginUiFocusSnapshot()
    snapshot.apply({
      windowFocused: true,
      kind: 'editor',
      title: '/Users/private/repo/secret.ts'
    })
    expect(snapshot.get()).toEqual({ kind: 'editor', title: 'secret.ts' })

    const cleared = snapshot.apply({ windowFocused: false })
    expect(cleared).toEqual({ changed: true, surface: null })
    expect(snapshot.get()).toBeNull()
  })
})
