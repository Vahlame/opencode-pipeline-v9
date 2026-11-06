import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorktreeManager } from '../../src/worktrees/manager.js'
import { WorktreeMaintenance } from '../../src/recovery/maintenance.js'
import { createCoreFixture } from '../helpers/phase2.js'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

describe('worktree maintenance', () => {
  it('removes only clean worktrees and preserves commits and dirty worktrees', () => {
    const root = mkdtempSync(join(tmpdir(), 'orch-maintenance-'))
    const fixture = createCoreFixture(root)
    try {
      git(root, ['init'])
      git(root, ['config', 'user.name', 'Maintenance'])
      git(root, ['config', 'user.email', 'maintenance@example.com'])
      writeFileSync(join(root, 'README.md'), '# maintenance\n')
      writeFileSync(join(root, '.gitignore'), '.worktrees/\n')
      git(root, ['add', '.'])
      git(root, ['commit', '-m', 'base'])
      const plan = fixture.approveAndStart()
      const coordinator = fixture.principalFor('coordinador')
      const frontend = fixture.agentByCode.get('frontend')!
      const module = fixture.service.createModule(coordinator, {
        projectId: fixture.project.id,
        name: 'maintenance',
        ownerAgentId: frontend.id,
        pathScope: ['modules/maintenance/**'],
      })
      const cleanTask = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Clean',
        description: 'Clean worktree',
        ownerAgentId: frontend.id,
      })
      const dirtyTask = fixture.service.createTask(coordinator, {
        projectId: fixture.project.id,
        planId: plan.id,
        moduleId: module.id,
        title: 'Dirty',
        description: 'Dirty worktree',
        ownerAgentId: frontend.id,
      })
      for (const task of [cleanTask, dirtyTask]) {
        fixture.store.updateTaskState(task.id, 'READY')
        fixture.store.updateTaskState(task.id, 'RUNNING')
        fixture.store.updateTaskState(task.id, 'IN_REVIEW')
        fixture.store.updateTaskState(task.id, 'APPROVED')
      }
      const worktrees = new WorktreeManager(root, join(root, '.worktrees'))
      const clean = worktrees.create(cleanTask.id)
      mkdirSync(join(clean.path, 'modules', 'maintenance'), { recursive: true })
      writeFileSync(join(clean.path, 'modules', 'maintenance', 'file.mjs'), 'export const x = 1\n')
      const commit = worktrees.commit(clean.path, ['modules/maintenance/**'], 'clean')
      const cleanRecord = fixture.store.createWorktree({
        taskId: cleanTask.id,
        moduleId: module.id,
        path: clean.path,
        branch: clean.branch,
        baseCommit: clean.baseCommit,
        status: 'COMMITTED',
      })
      fixture.store.db.run('UPDATE worktrees SET updated_at = ? WHERE id = ?', [
        '2020-01-01T00:00:00.000Z',
        cleanRecord.id,
      ])

      const dirty = worktrees.create(dirtyTask.id)
      mkdirSync(join(dirty.path, 'modules', 'maintenance'), { recursive: true })
      writeFileSync(join(dirty.path, 'modules', 'maintenance', 'dirty.mjs'), 'export const y = 2\n')
      const dirtyRecord = fixture.store.createWorktree({
        taskId: dirtyTask.id,
        moduleId: module.id,
        path: dirty.path,
        branch: dirty.branch,
        baseCommit: dirty.baseCommit,
        status: 'ACTIVE',
      })
      fixture.store.db.run('UPDATE worktrees SET updated_at = ? WHERE id = ?', [
        '2020-01-01T00:00:00.000Z',
        dirtyRecord.id,
      ])

      const maintenance = new WorktreeMaintenance(fixture.store, worktrees, 0)
      const planResult = maintenance.plan(fixture.project.id)
      expect(planResult.candidates.some((candidate) => candidate.path === clean.path)).toBe(true)
      expect(planResult.skipped.some((candidate) => candidate.path === dirty.path)).toBe(true)

      const applied = maintenance.apply(fixture.project.id)
      expect(applied.removed).toContain(clean.path)
      expect(fixture.store.getWorktreeByTask(cleanTask.id)?.status).toBe('REMOVED')
      expect(fixture.store.getWorktreeByTask(dirtyTask.id)?.status).toBe('ACTIVE')
      expect(git(root, ['cat-file', '-t', commit.commitSha])).toBe('commit')
    } finally {
      fixture.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
