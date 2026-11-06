import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { sha256 } from '../security/hash.js'

export class WorktreeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WorktreeError'
    this.code = code
  }
}

export interface WorktreeRecord {
  readonly path: string
  readonly branch: string
  readonly baseCommit: string
}

export interface WorktreeCommitResult {
  readonly commitSha: string
  readonly treeHash: string
  readonly artifactHash: string
  readonly filesChanged: readonly string[]
}

export interface TestCommandResult {
  readonly command: string
  readonly passed: boolean
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  })
  if (result.error) throw new WorktreeError('GIT_FAILED', result.error.message)
  if (result.status !== 0) {
    throw new WorktreeError(
      'GIT_FAILED',
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    )
  }
  return result.stdout.trim()
}

function normalizeSlashes(value: string): string {
  return value.replaceAll('\\', '/')
}

export function matchesAllowedPath(file: string, pattern: string): boolean {
  const normalizedFile = normalizeSlashes(file).replace(/^\/+/, '')
  const normalizedPattern = normalizeSlashes(pattern).replace(/^\/+/, '')
  if (normalizedPattern === '**') return true
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3)
    return normalizedFile === prefix || normalizedFile.startsWith(`${prefix}/`)
  }
  if (normalizedPattern.endsWith('*')) {
    const prefix = normalizedPattern.slice(0, -1)
    return normalizedFile.startsWith(prefix)
  }
  return normalizedFile === normalizedPattern
}

function parseStatusPaths(output: string): string[] {
  const entries = output.split('\0').filter(Boolean)
  const paths: string[] = []
  for (const entry of entries) {
    if (entry.length < 4) continue
    const path = entry.slice(3)
    if (path) paths.push(normalizeSlashes(path))
  }
  return paths
}

export class WorktreeManager {
  readonly repoRoot: string
  readonly worktreeRoot: string
  readonly emptyHooksPath: string

  constructor(repoRoot: string, worktreeRoot: string) {
    this.repoRoot = realpathSync.native(resolve(repoRoot))
    this.worktreeRoot = resolve(worktreeRoot)
    mkdirSync(this.worktreeRoot, { recursive: true })
    this.emptyHooksPath = join(this.worktreeRoot, '.empty-hooks')
    mkdirSync(this.emptyHooksPath, { recursive: true })
  }

  create(taskId: string, baseRef = 'HEAD'): WorktreeRecord {
    if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
      throw new WorktreeError('INVALID_TASK_ID', `Unsafe task id: ${taskId}`)
    }
    const path = join(this.worktreeRoot, taskId)
    if (existsSync(path)) {
      throw new WorktreeError('WORKTREE_EXISTS', `Worktree already exists: ${path}`)
    }
    const branch = `orch/task/${taskId}`
    const baseCommit = git(this.repoRoot, ['rev-parse', baseRef])
    git(this.repoRoot, ['worktree', 'add', '-b', branch, path, baseCommit])
    const canonicalPath = realpathSync.native(path)
    this.assertInsideRoot(canonicalPath)
    return { path: canonicalPath, branch, baseCommit }
  }

  list(): WorktreeRecord[] {
    const output = git(this.repoRoot, ['worktree', 'list', '--porcelain'])
    const records: WorktreeRecord[] = []
    let currentPath: string | undefined
    for (const line of output.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) currentPath = line.slice('worktree '.length)
      if (line.startsWith('branch ') && currentPath) {
        records.push({
          path: currentPath,
          branch: line.slice('branch '.length),
          baseCommit: '',
        })
      }
    }
    return records
  }

  changedPaths(path: string): string[] {
    const output = git(path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    return parseStatusPaths(output)
  }

  validateChangedPaths(path: string, allowedPaths: readonly string[]): string[] {
    const changed = this.changedPaths(path)
    for (const file of changed) this.assertAllowedFile(path, file, allowedPaths)
    return changed
  }

  runTests(path: string, commands: readonly string[], timeoutMs: number): TestCommandResult[] {
    const results: TestCommandResult[] = []
    for (const command of commands) {
      const parts = command.trim().split(/\s+/).filter(Boolean)
      if (parts[0] !== 'node') {
        throw new WorktreeError(
          'UNSAFE_TEST_COMMAND',
          `Only "node <script>" test commands are allowed, got: ${command}`,
        )
      }
      const started = performance.now()
      const result = spawnSync(process.execPath, parts.slice(1), {
        cwd: path,
        encoding: 'utf8',
        windowsHide: true,
        timeout: timeoutMs,
        env: {
          PATH: process.env.PATH ?? '',
          SystemRoot: process.env.SystemRoot ?? '',
          TEMP: process.env.TEMP ?? '',
          TMP: process.env.TMP ?? '',
        },
      })
      results.push({
        command,
        passed: result.status === 0,
        exitCode: result.status ?? -1,
        stdout: (result.stdout ?? '').slice(0, 20_000),
        stderr: (result.stderr ?? '').slice(0, 20_000),
        durationMs: Math.round(performance.now() - started),
      })
    }
    return results
  }

  commit(path: string, allowedPaths: readonly string[], message: string): WorktreeCommitResult {
    const changed = this.validateChangedPaths(path, allowedPaths)
    if (changed.length === 0) {
      throw new WorktreeError('EMPTY_DELIVERY', 'The specialist did not change any allowed file')
    }
    git(path, ['add', '--all', '--', ...changed])
    const staged = git(path, ['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)
    for (const file of staged) this.assertAllowedFile(path, normalizeSlashes(file), allowedPaths)
    git(path, [
      '-c',
      'user.name=OpenCode Orchestrator',
      '-c',
      'user.email=orchestrator@local',
      '-c',
      `core.hooksPath=${this.emptyHooksPath}`,
      'commit',
      '--no-verify',
      '-m',
      message,
    ])
    const commitSha = git(path, ['rev-parse', 'HEAD'])
    const treeHash = git(path, ['rev-parse', 'HEAD^{tree}'])
    return {
      commitSha,
      treeHash,
      artifactHash: sha256({ commitSha, treeHash }),
      filesChanged: changed,
    }
  }

  private assertAllowedFile(path: string, file: string, allowedPaths: readonly string[]): void {
    const normalized = normalizeSlashes(file)
    if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') {
      throw new WorktreeError('PATH_TRAVERSAL', `Unsafe path in delivery: ${file}`)
    }
    const absolute = resolve(path, normalized)
    const relativePath = relative(realpathSync.native(path), absolute)
    if (
      relativePath.startsWith(`..${sep}`) ||
      relativePath === '..' ||
      relativePath.includes(`..${sep}`)
    ) {
      throw new WorktreeError('PATH_TRAVERSAL', `Path escapes worktree: ${file}`)
    }
    if (normalized === '.git' || normalized.startsWith('.git/')) {
      throw new WorktreeError('PROTECTED_PATH', `Git metadata cannot be committed: ${file}`)
    }
    if (!allowedPaths.some((pattern) => matchesAllowedPath(normalized, pattern))) {
      throw new WorktreeError('PATH_NOT_ALLOWED', `Path is outside the contract: ${file}`)
    }
    if (existsSync(absolute)) {
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new WorktreeError('SYMLINK', `Symlink not allowed: ${file}`)
    }
  }

  private assertInsideRoot(path: string): void {
    const relativePath = relative(realpathSync.native(this.worktreeRoot), path)
    if (
      relativePath.startsWith(`..${sep}`) ||
      relativePath === '..' ||
      relativePath.startsWith('/')
    ) {
      throw new WorktreeError('PATH_TRAVERSAL', `Worktree escapes root: ${path}`)
    }
  }
}
