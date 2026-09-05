import { describe, expect, it } from 'vitest'
import { gatePluginHostCall } from './plugin-capability-gate'
import { isPluginPanelAction, PLUGIN_PANEL_ACTIONS } from './plugin-host-api'
import { parsePanelActionRequest } from './plugin-panel-bridge'

const WORKER_ONLY = [
  'storage.get',
  'storage.set',
  'storage.delete',
  'storage.keys',
  'secrets.get',
  'secrets.set',
  'secrets.delete',
  'events.subscribe'
] as const

describe('PLUGIN_HOST_API_V0 panel surface', () => {
  it('lets sandboxed panels call plugin-private settings.get/set', () => {
    expect(PLUGIN_PANEL_ACTIONS).toEqual(expect.arrayContaining(['settings.get', 'settings.set']))
    expect(isPluginPanelAction('settings.get')).toBe(true)
    expect(isPluginPanelAction('settings.set')).toBe(true)
  })

  it('keeps storage, secrets, and events worker-only', () => {
    for (const name of WORKER_ONLY) {
      expect(isPluginPanelAction(name), name).toBe(false)
    }
  })

  it('parses settings panel requests and rejects storage', () => {
    expect(
      parsePanelActionRequest({
        type: 'orca-panel-action',
        requestId: 'req-1',
        action: 'settings.get'
      }).ok
    ).toBe(true)
    expect(
      parsePanelActionRequest({
        type: 'orca-panel-action',
        requestId: 'req-2',
        action: 'settings.set',
        params: { key: 'theme', value: 'dark' }
      }).ok
    ).toBe(true)
    expect(
      parsePanelActionRequest({
        type: 'orca-panel-action',
        requestId: 'req-3',
        action: 'storage.get',
        params: { key: 'alpha' }
      })
    ).toMatchObject({ ok: false, requestId: 'req-3' })
  })

  it('gates panel settings to settings:own and still forbids storage', () => {
    expect(
      gatePluginHostCall({ grantedCapabilities: ['settings:own'], viaPanel: true }, 'settings.get')
    ).toEqual({ granted: true })
    expect(
      gatePluginHostCall({ grantedCapabilities: ['settings:own'], viaPanel: true }, 'settings.set')
    ).toEqual({ granted: true })
    expect(
      gatePluginHostCall({ grantedCapabilities: ['storage'], viaPanel: true }, 'settings.get')
    ).toMatchObject({ granted: false, code: 'capability_denied' })
    expect(
      gatePluginHostCall({ grantedCapabilities: ['storage'], viaPanel: true }, 'storage.get')
    ).toMatchObject({ granted: false, code: 'panel_forbidden' })
  })
})
