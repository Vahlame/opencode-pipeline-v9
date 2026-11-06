import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import type { TestCommandResult } from '../worktrees/manager.js'
import { WorktreeError } from '../worktrees/manager.js'
import type { WorktreeManager } from '../worktrees/manager.js'

export interface IntegrationWorkspaceHandle {
  readonly path: string
  readonly baseCommit: string
}

export interface AppliedModulePaths {
  readonly roots: readonly string[]
  readonly moduleTreeHash: string
}

export interface WorkspaceCommitResult {
  readonly commitSha: string
  readonly treeHash: string
  readonly filesChanged: readonly string[]
}

export interface IntegrationWorkspace {
  resolveCommit(ref: string): string
  prepare(name: string, baseCommit: string): IntegrationWorkspaceHandle
  applyModule(
    workspace: IntegrationWorkspaceHandle,
    commitSha: string,
    pathScopes: readonly string[],
  ): AppliedModulePaths
  writeFile(workspace: IntegrationWorkspaceHandle, relativePath: string, content: string): void
  readFile(workspace: IntegrationWorkspaceHandle, relativePath: string): string
  runTests(
    workspace: IntegrationWorkspaceHandle,
    commands: readonly string[],
    timeoutMs: number,
  ): TestCommandResult[]
  changedPaths(workspace: IntegrationWorkspaceHandle): string[]
  differsFromCommit(workspace: IntegrationWorkspaceHandle, commitSha: string, path: string): boolean
  commit(
    workspace: IntegrationWorkspaceHandle,
    allowedPaths: readonly string[],
    message: string,
    timestamp: string,
  ): WorkspaceCommitResult
  commitExists(commitSha: string, expectedTreeHash?: string): boolean
  treeAtPath(commitSha: string, path: string): string
}

function gitResult(cwd: string, args: readonly string[]) {
  return spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: process.env,
  })
}

function git(cwd: string, args: readonly string[]): string {
  const result = gitResult(cwd, args)
  if (result.error) throw new WorktreeError('GIT_FAILED', result.error.message)
  if (result.status !== 0) {
    throw new WorktreeError(
      'GIT_FAILED',
      `git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
    )
  }
  return result.stdout.trim()
}

function normalize(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '')
}

/**
 * Deriva la raiz fisica de un pathScope. Se rechazan comodines internos y
 * scope de archivo: la integracion solo compone snapshots de directorios de
 * modulo.
 */
export function moduleRootFromScope(scope: string): string {
  const normalized = normalize(scope)
  const star = normalized.indexOf('*')
  const prefix = (star >= 0 ? normalized.slice(0, star) : normalized).replace(/\/+$/, '')
  if (!prefix || prefix === '.' || prefix.includes('*')) {
    throw new WorktreeError('INVALID_MODULE_SCOPE', `Cannot derive a module root from: ${scope}`)
  }
  if (prefix.split('/').some((part) => part === '..' || part === '')) {
    throw new WorktreeError('PATH_TRAVERSAL', `Unsafe module scope: ${scope}`)
  }
  if (prefix === '.git' || prefix.startsWith('.git/')) {
    throw new WorktreeError('PROTECTED_PATH', `Module scope cannot target Git metadata: ${scope}`)
  }
  return prefix
}

function assertInside(workspacePath: string, relativePath: string): string {
  const absolute = resolve(workspacePath, relativePath)
  const root = realpathSync.native(workspacePath)
  const targetRelative = relative(root, absolute)
  if (
    targetRelative === '..' ||
    targetRelative.startsWith(`..${sep}`) ||
    targetRelative.startsWith('/')
  ) {
    throw new WorktreeError('PATH_TRAVERSAL', `Path escapes integration workspace: ${relativePath}`)
  }
  if (relativePath === '.git' || relativePath.startsWith('.git/')) {
    throw new WorktreeError('PROTECTED_PATH', 'Git metadata is protected')
  }
  return absolute
}

export class GitIntegrationWorkspace implements IntegrationWorkspace {
  constructor(
    private readonly worktrees: WorktreeManager,
    private readonly timeoutMs = 300_000,
  ) {}

  resolveCommit(ref: string): string {
    return this.worktrees.resolveCommit(ref)
  }

  prepare(name: string, baseCommit: string): IntegrationWorkspaceHandle {
    const workspace = this.worktrees.createIntegration(name, baseCommit)
    return { path: workspace.path, baseCommit }
  }

  applyModule(
    workspace: IntegrationWorkspaceHandle,
    commitSha: string,
    pathScopes: readonly string[],
  ): AppliedModulePaths {
    const roots = [...new Set(pathScopes.map(moduleRootFromScope))]
    if (roots.length === 0) {
      throw new WorktreeError('INVALID_MODULE_SCOPE', 'Module has no path scopes')
    }
    for (const root of roots) {
      assertInside(workspace.path, root)
      const existing = this.treeHashAtCommit(commitSha, root)
      if (!existing) {
        throw new WorktreeError(
          'MISSING_MODULE_CONTENT',
          `Approved commit ${commitSha} has no content at ${root}`,
        )
      }
      git(workspace.path, ['rm', '-r', '--cached', '--ignore-unmatch', '--', root])
      rmSync(resolve(workspace.path, root), { recursive: true, force: true })
      git(workspace.path, ['checkout', commitSha, '--', root])
    }
    const treeHashes = roots.map((root) => `${root}=${this.treeHashAtCommit(commitSha, root)}`)
    return {
      roots,
      moduleTreeHash: treeHashes.join('|'),
    }
  }

  writeFile(workspace: IntegrationWorkspaceHandle, relativePath: string, content: string): void {
    const normalized = normalize(relativePath)
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) {
      throw new WorktreeError('PATH_TRAVERSAL', `Unsafe integration file: ${relativePath}`)
    }
    const absolute = assertInside(workspace.path, normalized)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, 'utf8')
  }

  readFile(workspace: IntegrationWorkspaceHandle, relativePath: string): string {
    const normalized = normalize(relativePath)
    if (!normalized || normalized.startsWith('/') || normalized.includes('../')) {
      throw new WorktreeError('PATH_TRAVERSAL', `Unsafe integration file: ${relativePath}`)
    }
    return readFileSync(assertInside(workspace.path, normalized), 'utf8')
  }

  runTests(
    workspace: IntegrationWorkspaceHandle,
    commands: readonly string[],
    timeoutMs = this.timeoutMs,
  ): TestCommandResult[] {
    return this.worktrees.runTests(workspace.path, commands, timeoutMs)
  }

  changedPaths(workspace: IntegrationWorkspaceHandle): string[] {
    return this.worktrees.changedPaths(workspace.path)
  }

  differsFromCommit(
    workspace: IntegrationWorkspaceHandle,
    commitSha: string,
    path: string,
  ): boolean {
    const result = gitResult(workspace.path, ['diff', '--quiet', commitSha, '--', path])
    if (result.error) throw new WorktreeError('GIT_FAILED', result.error.message)
    if (result.status === 0) return false
    if (result.status === 1) return true
    throw new WorktreeError(
      'GIT_FAILED',
      `git diff failed: ${(result.stderr || result.stdout).trim()}`,
    )
  }

  commit(
    workspace: IntegrationWorkspaceHandle,
    allowedPaths: readonly string[],
    message: string,
    timestamp: string,
  ): WorkspaceCommitResult {
    const result = this.worktrees.commit(workspace.path, allowedPaths, message, {
      timestamp,
      authorName: 'OpenCode Orchestrator',
      authorEmail: 'orchestrator@local',
    })
    return {
      commitSha: result.commitSha,
      treeHash: result.treeHash,
      filesChanged: result.filesChanged,
    }
  }

  commitExists(commitSha: string, expectedTreeHash?: string): boolean {
    if (!/^[0-9a-f]{40}$/i.test(commitSha)) return false
    try {
      const type = git(this.worktrees.repoRoot, ['cat-file', '-t', commitSha])
      if (type !== 'commit') return false
      if (expectedTreeHash) {
        return this.worktrees.treeOfCommit(commitSha) === expectedTreeHash
      }
      return true
    } catch {
      return false
    }
  }

  treeAtPath(commitSha: string, path: string): string {
    return this.worktrees.treeAtPath(commitSha, path)
  }

  private treeHashAtCommit(commitSha: string, path: string): string | undefined {
    const result = gitResult(this.worktrees.repoRoot, ['rev-parse', `${commitSha}:${path}`])
    if (result.status !== 0) return undefined
    return result.stdout.trim()
  }
}
