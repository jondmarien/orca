import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const POLL_INTERVAL_SOURCE = join(
  import.meta.dirname,
  '../renderer/src/components/terminal-pane/agent-completion-poll-interval.ts'
)

describe('process-table-snapshot renderer evaluation', () => {
  it('evaluates PS_ARGS and the snapshot TTL when Node process is absent', () => {
    const moduleUrl = pathToFileURL(join(import.meta.dirname, 'process-table-snapshot.ts')).href
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--no-warnings',
        '--input-type=module',
        '-e',
        `
        delete globalThis.process
        const snapshot = await import(${JSON.stringify(moduleUrl)})
        if (snapshot.PS_ARGS?.[0] !== '-axo') {
          throw new Error('PS_ARGS missing')
        }
        if (snapshot.PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS !== 500) {
          throw new Error(\`TTL missing: \${String(snapshot.PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS)}\`)
        }
        `
      ],
      { encoding: 'utf8' }
    )

    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('keeps the renderer poll interval off the process-table exec reader', () => {
    const source = readFileSync(POLL_INTERVAL_SOURCE, 'utf8')
    expect(source).not.toMatch(/process-table-snapshot-reader/)
    expect(source).toMatch(/PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS/)
  })
})
