import { z } from 'zod'
import { clampUtf8TextPrefix } from '../utf8-byte-limits'

/**
 * Privacy-safe UI focus projection for plugins. Kind is a coarse surface
 * label; title is truncated and never a path or URL. Default off: only
 * plugins that declare `ui:focus` receive this (readContext field + event).
 */

export const PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES = 80
export const PLUGIN_FOCUSED_SURFACE_KINDS = [
  'terminal',
  'agent',
  'browser',
  'editor',
  'simulator',
  'command-palette'
] as const

export type PluginFocusedSurfaceKind = (typeof PLUGIN_FOCUSED_SURFACE_KINDS)[number]

export const pluginFocusedSurfaceKindSchema = z.enum(PLUGIN_FOCUSED_SURFACE_KINDS)

export const pluginFocusedSurfaceSchema = z
  .object({
    kind: pluginFocusedSurfaceKindSchema,
    title: z.string().max(PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES).nullable()
  })
  .strict()

export type PluginFocusedSurface = z.infer<typeof pluginFocusedSurfaceSchema>

export const pluginUiFocusChangedPayloadSchema = z
  .object({
    focusedSurface: pluginFocusedSurfaceSchema.nullable(),
    receivedAt: z.number().finite().positive()
  })
  .strict()

export type PluginUiFocusChangedPayload = z.infer<typeof pluginUiFocusChangedPayloadSchema>

export const pluginUiFocusReportSchema = z
  .object({
    windowFocused: z.boolean().optional(),
    kind: pluginFocusedSurfaceKindSchema.optional(),
    title: z.string().max(4096).nullable().optional()
  })
  .strict()

export type PluginUiFocusReport = z.infer<typeof pluginUiFocusReportSchema>

export function projectPluginFocusedTitle(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null
  }
  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }
  return clampUtf8TextPrefix(
    sanitizePluginFocusedTitle(trimmed),
    PLUGIN_FOCUSED_SURFACE_TITLE_MAX_BYTES
  )
}

function sanitizePluginFocusedTitle(value: string): string {
  const hostname = hostnameFromHttpUrl(value)
  if (hostname) {
    return hostname
  }
  if (/[\\/]/.test(value)) {
    const withoutTrailing = value.replace(/[\\/]+$/, '')
    const base = withoutTrailing.split(/[\\/]/).pop()
    return base && base.length > 0 ? base : withoutTrailing
  }
  return value
}

function hostnameFromHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.hostname || null
  } catch {
    return null
  }
}

export function projectPluginUiFocusReport(raw: unknown): PluginFocusedSurface | null {
  const parsed = pluginUiFocusReportSchema.safeParse(raw)
  if (!parsed.success || parsed.data.windowFocused === false || parsed.data.kind === undefined) {
    return null
  }
  return {
    kind: parsed.data.kind,
    title: projectPluginFocusedTitle(parsed.data.title)
  }
}

export function pluginFocusedSurfacesEqual(
  left: PluginFocusedSurface | null,
  right: PluginFocusedSurface | null
): boolean {
  if (left === right) {
    return true
  }
  if (left === null || right === null) {
    return false
  }
  return left.kind === right.kind && left.title === right.title
}
