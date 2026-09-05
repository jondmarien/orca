import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const RENDERER_SRC = join(REPO_ROOT, 'src/renderer/src')
const TTL_MODULE = 'src/shared/process-table-snapshot-ttl.ts'
const SNAPSHOT_MODULE = 'src/shared/process-table-snapshot.ts'
const READER_MODULE = 'src/shared/process-table-snapshot-reader.ts'
const POLL_INTERVAL_MODULE =
  'src/renderer/src/components/terminal-pane/agent-completion-poll-interval.ts'
const TABS_SYNC_MODULE = 'src/renderer/src/runtime/web-session-tabs-sync.ts'

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']
const STATIC_IMPORT =
  /(?:^|[\n;])\s*(?:import|export)(?:(?!\bfrom\b)[\s\S])*?\bfrom\s*['"]([^'"]+)['"]/g
const NODE_CAPTURE_IMPORT =
  /from\s*['"](?:node:)?(?:child_process|util)['"]|\bexecFile\b|\bpromisify\b/

function repoKey(file: string): string {
  return relative(REPO_ROOT, file).split('\\').join('/')
}

function resolveImport(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(RENDERER_SRC, specifier.slice(2))
    : specifier.startsWith('@renderer/')
      ? join(RENDERER_SRC, specifier.slice('@renderer/'.length))
      : specifier.startsWith('.')
        ? resolve(dirname(fromFile), specifier)
        : null
  if (base === null) {
    return null
  }
  for (const extension of ['', ...MODULE_EXTENSIONS]) {
    const candidate = base + extension
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  for (const extension of MODULE_EXTENSIONS) {
    const candidate = join(base, `index${extension}`)
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate
    }
  }
  return null
}

function walkStaticImports(rootRelative: string): Set<string> {
  const root = join(REPO_ROOT, rootRelative)
  const visited = new Set<string>()
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop() as string
    const key = repoKey(current)
    if (visited.has(key)) {
      continue
    }
    visited.add(key)
    const contents = readFileSync(current, 'utf8')
    for (const match of contents.matchAll(STATIC_IMPORT)) {
      if (/^\s*(?:import|export)\s+type\b/.test(match[0].replace(/^[\n;]/, ''))) {
        continue
      }
      const resolved = resolveImport(match[1] as string, current)
      if (resolved === null) {
        continue
      }
      queue.push(resolved)
    }
  }
  return visited
}

function collectRendererProductionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') {
        continue
      }
      collectRendererProductionSources(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) {
      continue
    }
    out.push(full)
  }
  return out
}

describe('process-table-snapshot renderer import boundary', () => {
  it('keeps the TTL module free of Node process, promisify, and execFile', () => {
    const source = readFileSync(join(REPO_ROOT, TTL_MODULE), 'utf8')
    expect(source).not.toMatch(/\bprocess\b/)
    expect(source).not.toMatch(NODE_CAPTURE_IMPORT)
    expect(source).toMatch(/export const PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS = 500/)
  })

  it('evaluates the TTL module when Node process is absent', () => {
    const moduleUrl = pathToFileURL(join(REPO_ROOT, TTL_MODULE)).href
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-transform-types',
        '--no-warnings',
        '--input-type=module',
        '-e',
        `
        delete globalThis.process
        const ttl = await import(${JSON.stringify(moduleUrl)})
        if (ttl.PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS !== 500) {
          throw new Error(\`TTL missing: \${String(ttl.PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS)}\`)
        }
        `
      ],
      { encoding: 'utf8' }
    )

    expect(result.status, result.stderr || result.stdout).toBe(0)
  })

  it('keeps tabs-sync and the poll interval off the process-table exec reader and parser', () => {
    const tabsSync = walkStaticImports(TABS_SYNC_MODULE)
    const pollInterval = walkStaticImports(POLL_INTERVAL_MODULE)

    expect(tabsSync.size).toBeGreaterThan(20)
    expect(tabsSync).toContain(POLL_INTERVAL_MODULE)
    expect(tabsSync).toContain(TTL_MODULE)
    expect(tabsSync.has(READER_MODULE)).toBe(false)
    expect(tabsSync.has(SNAPSHOT_MODULE)).toBe(false)

    expect(pollInterval).toContain(TTL_MODULE)
    expect(pollInterval.has(READER_MODULE)).toBe(false)
    expect(pollInterval.has(SNAPSHOT_MODULE)).toBe(false)
  })

  it('does not evaluate promisify or execFile on the tabs-sync static graph', () => {
    const tabsSync = walkStaticImports(TABS_SYNC_MODULE)
    const offenders = [...tabsSync].filter((key) => {
      const source = readFileSync(join(REPO_ROOT, key), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
        .join('\n')
      return NODE_CAPTURE_IMPORT.test(source)
    })

    expect(offenders).toEqual([])
  })

  it('has no renderer production import of the process-table exec reader or parser', () => {
    const importers = collectRendererProductionSources(RENDERER_SRC)
      .map((file) => repoKey(file))
      .filter((key) => {
        const source = readFileSync(join(REPO_ROOT, key), 'utf8')
        return (
          /process-table-snapshot-reader/.test(source) ||
          /process-table-snapshot(?:\.ts)?['"]/.test(source)
        )
      })

    expect(importers).toEqual([])
  })
})
