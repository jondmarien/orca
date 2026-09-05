import {
  PLUGIN_SIDECAR_MAILBOX_SLOT_LIMIT,
  buildSidecarPlacement,
  type PluginSidecarPlacement,
  type PluginSidecarPublishParams,
  type PluginSidecarPublishResult,
  type PluginSidecarStoredFrame
} from '../../shared/plugins/plugin-sidecar-contract'

function mailboxKey(pluginKey: string, channel: PluginSidecarStoredFrame['channel']): string {
  return `${pluginKey}\0${channel}`
}

/** Process-local last-frame store shared by plugin host calls and runtime RPC. */
export class PluginSidecarMailbox {
  private readonly frames = new Map<string, PluginSidecarStoredFrame>()

  resolvePlacement(pluginKey?: string): PluginSidecarPlacement {
    return buildSidecarPlacement(this.lastPublishedAt(pluginKey))
  }

  publish(pluginKey: string, input: PluginSidecarPublishParams): PluginSidecarPublishResult {
    const publishedAt = Date.now()
    const frame: PluginSidecarStoredFrame = {
      pluginKey,
      channel: input.channel,
      op: input.op,
      payload: input.op === 'clear' ? null : (input.payload ?? null),
      publishedAt
    }
    this.frames.set(mailboxKey(pluginKey, input.channel), frame)
    this.evictOldestIfNeeded()
    return {
      accepted: true,
      delivery: 'stored',
      placement: buildSidecarPlacement(publishedAt)
    }
  }

  latest(pluginKey?: string): PluginSidecarStoredFrame[] {
    const frames = [...this.frames.values()].sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) {
        return left.publishedAt - right.publishedAt
      }
      return `${left.pluginKey}\0${left.channel}`.localeCompare(
        `${right.pluginKey}\0${right.channel}`
      )
    })
    if (!pluginKey) {
      return frames
    }
    return frames.filter((frame) => frame.pluginKey === pluginKey)
  }

  private lastPublishedAt(pluginKey?: string): number | null {
    const frames = this.latest(pluginKey)
    if (frames.length === 0) {
      return null
    }
    return frames[frames.length - 1]!.publishedAt
  }

  private evictOldestIfNeeded(): void {
    while (this.frames.size > PLUGIN_SIDECAR_MAILBOX_SLOT_LIMIT) {
      const oldest = this.latest()[0]
      if (!oldest) {
        return
      }
      this.frames.delete(mailboxKey(oldest.pluginKey, oldest.channel))
    }
  }
}
