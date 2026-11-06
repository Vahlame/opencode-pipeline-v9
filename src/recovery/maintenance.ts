import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { ProjectId } from '../domain/ids.js'
import type { SqliteStore, WorktreeRecord } from '../persistence/store.js'
import type { WorktreeManager } from '../worktrees/manager.js'

export interface MaintenanceCandidate {
  readonly kind: 'task_worktree' | 'snapshot'
  readonly path: string
  readonly reason: string
  readonly worktreeId?: string
  readonly taskId?: string
}

export interface MaintenancePlan {
  readonly projectId: ProjectId
  readonly keepDays: number
  readonly dryRun: boolean
  readonly candidates: readonly MaintenanceCandidate[]
  readonly skipped: ReadonlyArray<{ path: string; reason: string }>
}

export interface MaintenanceResult extends MaintenancePlan {
  readonly removed: readonly string[]
  readonly failed: ReadonlyArray<{ path: string; error: string }>
}

export class WorktreeMaintenance {
  constructor(
    private readonly store: SqliteStore,
    private readonly worktrees: WorktreeManager,
    private readonly keepDays: number,
  ) {}

  plan(projectId: ProjectId): MaintenancePlan {
    const now = Date.now()
    const threshold = now - this.keepDays * 24 * 60 * 60 * 1000
    const tasks = new Map(this.store.listTasks(projectId).map((task) => [task.id, task]))
    const candidates: MaintenanceCandidate[] = []
    const skipped: Array<{ path: string; reason: string }> = []

    for (const worktree of this.store.listWorktrees(projectId)) {
      if (worktree.status === 'REMOVED') continue
      const task = tasks.get(worktree.taskId)
      if (!task) {
        skipped.push({ path: worktree.path, reason: 'task not found' })
        continue
      }
      if (['RUNNING', 'READY', 'PENDING'].includes(task.state)) {
        skipped.push({ path: worktree.path, reason: `task is ${task.state}` })
        continue
      }
      if (!existsSync(worktree.path)) {
        candidates.push({
          kind: 'task_worktree',
          path: worktree.path,
          reason: 'path is missing; safe to reconcile in database',
          worktreeId: worktree.id,
          taskId: task.id,
        })
        continue
      }
      const age = now - Date.parse(worktree.updatedAt)
      if (age < this.keepDays * 24 * 60 * 60 * 1000) {
        skipped.push({ path: worktree.path, reason: `retained for ${this.keepDays} days` })
        continue
      }
      try {
        if (this.worktrees.changedPaths(worktree.path).length > 0) {
          skipped.push({ path: worktree.path, reason: 'worktree has uncommitted changes' })
          continue
        }
      } catch (error) {
        skipped.push({
          path: worktree.path,
          reason: `cannot inspect worktree: ${error instanceof Error ? error.message : String(error)}`,
        })
        continue
      }
      candidates.push({
        kind: 'task_worktree',
        path: worktree.path,
        reason: `clean worktree older than ${this.keepDays} days`,
        worktreeId: worktree.id,
        taskId: task.id,
      })
    }

    for (const directory of ['reviews', 'integrations']) {
      const root = join(this.worktrees.worktreeRoot, directory)
      if (!existsSync(root)) continue
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const path = join(root, entry.name)
        const stat = statSync(path)
        if (stat.mtimeMs >= threshold) {
          skipped.push({ path, reason: `retained for ${this.keepDays} days` })
          continue
        }
        if (!this.isInsideWorktreeRoot(path)) {
          skipped.push({ path, reason: 'outside configured worktree root' })
          continue
        }
        try {
          if (this.worktrees.changedPaths(path).length > 0) {
            skipped.push({ path, reason: 'snapshot has uncommitted changes' })
            continue
          }
        } catch {
          // Un snapshot detached puede no tener .git propio; se conserva.
          skipped.push({ path, reason: 'cannot inspect snapshot safely' })
          continue
        }
        candidates.push({
          kind: 'snapshot',
          path,
          reason: `snapshot older than ${this.keepDays} days`,
        })
      }
    }

    return {
      projectId,
      keepDays: this.keepDays,
      dryRun: true,
      candidates,
      skipped,
    }
  }

  apply(projectId: ProjectId): MaintenanceResult {
    const plan = this.plan(projectId)
    const removed: string[] = []
    const failed: Array<{ path: string; error: string }> = []
    for (const candidate of plan.candidates) {
      if (!existsSync(candidate.path)) {
        if (candidate.worktreeId) {
          this.store.updateWorktreeStatus(candidate.worktreeId, 'REMOVED')
        }
        removed.push(candidate.path)
        continue
      }
      const result = spawnSync('git', ['worktree', 'remove', candidate.path], {
        cwd: this.worktrees.repoRoot,
        encoding: 'utf8',
        windowsHide: true,
      })
      if (result.status !== 0) {
        failed.push({
          path: candidate.path,
          error: (result.stderr || result.stdout).trim() || 'git worktree remove failed',
        })
        continue
      }
      if (candidate.worktreeId) {
        this.store.updateWorktreeStatus(candidate.worktreeId, 'REMOVED')
      }
      removed.push(candidate.path)
    }
    spawnSync('git', ['worktree', 'prune'], {
      cwd: this.worktrees.repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    })
    return {
      ...plan,
      dryRun: false,
      removed,
      failed,
    }
  }

  private isInsideWorktreeRoot(path: string): boolean {
    const relativePath = relative(resolve(this.worktrees.worktreeRoot), resolve(path))
    return (
      relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`) &&
      !relativePath.startsWith('/')
    )
  }
}

export function orphanedWorktrees(store: SqliteStore, projectId: ProjectId): WorktreeRecord[] {
  return store
    .listWorktrees(projectId)
    .filter((worktree) => worktree.status === 'ACTIVE' && !existsSync(worktree.path))
}
