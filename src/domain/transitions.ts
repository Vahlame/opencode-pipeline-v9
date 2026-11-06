import type { ModuleStatus, PlanStatus, ProjectStatus, TaskState } from './enums.js'

export class InvalidTransitionError extends Error {
  readonly from: string
  readonly to: string

  constructor(entity: string, from: string, to: string) {
    super(`Invalid ${entity} transition: ${from} -> ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

const PROJECT_TRANSITIONS: Readonly<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  DRAFT: ['PLAN_PROPOSED', 'CANCELLED'],
  PLAN_PROPOSED: ['AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'FAILED', 'CANCELLED'],
  APPROVED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['PAUSED', 'INTEGRATING', 'FAILED', 'CANCELLED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  INTEGRATING: ['FEEDBACK', 'RUNNING', 'FAILED', 'CANCELLED'],
  FEEDBACK: ['COMPLETED', 'RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
}

const PLAN_TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  DRAFT: ['PROPOSED', 'SUPERSEDED'],
  PROPOSED: ['APPROVED', 'REJECTED', 'SUPERSEDED'],
  APPROVED: ['SUPERSEDED'],
  REJECTED: [],
  SUPERSEDED: [],
}

const TASK_TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  PENDING: ['READY', 'BLOCKED', 'CANCELLED'],
  READY: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['IN_REVIEW', 'REWORK_REQUIRED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'REWORK_REQUIRED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  REWORK_REQUIRED: ['READY', 'BLOCKED', 'FAILED', 'CANCELLED'],
  APPROVED: ['INTEGRATED', 'BLOCKED'],
  INTEGRATED: [],
  BLOCKED: ['READY', 'FAILED', 'CANCELLED'],
  FAILED: ['READY', 'CANCELLED'],
  CANCELLED: [],
}

const MODULE_TRANSITIONS: Readonly<Record<ModuleStatus, readonly ModuleStatus[]>> = {
  DRAFT: ['IN_REVIEW'],
  IN_REVIEW: ['APPROVED', 'REWORK_REQUIRED', 'REJECTED'],
  REWORK_REQUIRED: ['IN_REVIEW'],
  APPROVED: ['INTEGRATED'],
  INTEGRATED: [],
  REJECTED: ['DRAFT'],
}

function can<T extends string>(
  transitions: Readonly<Record<T, readonly T[]>>,
  from: T,
  to: T,
): boolean {
  return transitions[from]?.includes(to) ?? false
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return can(PROJECT_TRANSITIONS, from, to)
}

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return can(PLAN_TRANSITIONS, from, to)
}

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return can(TASK_TRANSITIONS, from, to)
}

export function canTransitionModule(from: ModuleStatus, to: ModuleStatus): boolean {
  return can(MODULE_TRANSITIONS, from, to)
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new InvalidTransitionError('task', from, to)
  }
}

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!canTransitionProject(from, to)) {
    throw new InvalidTransitionError('project', from, to)
  }
}

export function assertPlanTransition(from: PlanStatus, to: PlanStatus): void {
  if (!canTransitionPlan(from, to)) {
    throw new InvalidTransitionError('plan', from, to)
  }
}

export function assertModuleTransition(from: ModuleStatus, to: ModuleStatus): void {
  if (!canTransitionModule(from, to)) {
    throw new InvalidTransitionError('module', from, to)
  }
}

export function nextProjectStates(from: ProjectStatus): readonly ProjectStatus[] {
  return PROJECT_TRANSITIONS[from]
}

export function nextTaskStates(from: TaskState): readonly TaskState[] {
  return TASK_TRANSITIONS[from]
}
