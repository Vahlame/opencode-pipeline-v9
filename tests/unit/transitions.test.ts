import { describe, expect, it } from 'vitest'
import {
  assertTaskTransition,
  canTransitionTask,
  InvalidTransitionError,
  nextTaskStates,
} from '../../src/domain/index.js'

describe('task state transitions', () => {
  it('does not allow PENDING -> RUNNING', () => {
    expect(canTransitionTask('PENDING', 'RUNNING')).toBe(false)
    expect(() => assertTaskTransition('PENDING', 'RUNNING')).toThrow(InvalidTransitionError)
  })

  it('allows the normal delivery path', () => {
    expect(canTransitionTask('PENDING', 'READY')).toBe(true)
    expect(canTransitionTask('READY', 'RUNNING')).toBe(true)
    expect(canTransitionTask('RUNNING', 'IN_REVIEW')).toBe(true)
    expect(canTransitionTask('IN_REVIEW', 'APPROVED')).toBe(true)
    expect(canTransitionTask('APPROVED', 'INTEGRATED')).toBe(true)
  })

  it('allows rework only back to READY', () => {
    expect(canTransitionTask('REWORK_REQUIRED', 'READY')).toBe(true)
    expect(canTransitionTask('REWORK_REQUIRED', 'RUNNING')).toBe(false)
  })

  it('does not allow transitions from INTEGRATED', () => {
    expect(nextTaskStates('INTEGRATED')).toEqual([])
  })
})
