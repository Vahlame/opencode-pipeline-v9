import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager, matchesAllowedPath } from '../../src/worktrees/manager.js'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

describe('Git worktree isolation', () => {
  let root: string | undefined

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = undefined
  })

  it('creates independent worktrees and validates allowed paths', () => {
    root = mkdtempSync(join(tmpdir(), 'orch-worktree-'))
    git(root, ['init'])
    git(root, ['config', 'user.name', 'Test'])
    git(root, ['config', 'user.email', 'test@example.com'])
    mkdirSync(join(root, 'modules'), { recursive: true })
    writeFileSync(join(root, 'README.md'), '# base\n')
    writeFileSync(join(root, '.gitignore'), '.worktrees/\n')
    git(root, ['add', '.'])
    git(root, ['commit', '-m', 'base'])

    const manager = new WorktreeManager(root, join(root, '.worktrees'))
    const first = manager.create('task_first')
    const second = manager.create('task_second')
    expect(first.path).not.toBe(second.path)
    expect(manager.list().length).toBeGreaterThanOrEqual(2)

    mkdirSync(join(first.path, 'modules', 'frontend'), { recursive: true })
    writeFileSync(
      join(first.path, 'modules', 'frontend', 'demo.mjs'),
      'export const add = (a,b)=>a+b\n',
    )
    writeFileSync(
      join(first.path, 'modules', 'frontend', 'demo.test.mjs'),
      "import assert from 'node:assert/strict'; import { add } from './demo.mjs'; assert.equal(add(2,3),5); console.log('PASS')\n",
    )
    const tests = manager.runTests(first.path, ['node modules/frontend/demo.test.mjs'], 10_000)
    expect(tests[0]?.passed).toBe(true)
    const commit = manager.commit(first.path, ['modules/frontend/**'], 'task first')
    expect(commit.commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(commit.filesChanged).toContain('modules/frontend/demo.mjs')

    writeFileSync(join(first.path, 'outside.txt'), 'not allowed\n')
    expect(() => manager.commit(first.path, ['modules/frontend/**'], 'bad')).toThrow(
      /outside the contract/,
    )
  })

  it('matches glob-style allowed paths', () => {
    expect(matchesAllowedPath('modules/frontend/a.ts', 'modules/frontend/**')).toBe(true)
    expect(matchesAllowedPath('modules/backend/a.ts', 'modules/frontend/**')).toBe(false)
    expect(matchesAllowedPath('tests/a.ts', 'tests/**')).toBe(true)
  })
})
