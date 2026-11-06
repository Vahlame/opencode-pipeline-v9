import { z } from 'zod'

/**
 * Identificadores opacos y estables. El prefijo de marca evita mezclar IDs de
 * entidades distintas en el compilador.
 */
const opaqueId = <Brand extends string>() => z.string().min(1).brand<Brand>()

export const ProjectIdSchema = opaqueId<'ProjectId'>()
export const PlanIdSchema = opaqueId<'PlanId'>()
export const AgentIdSchema = opaqueId<'AgentId'>()
export const TaskIdSchema = opaqueId<'TaskId'>()
export const ModuleIdSchema = opaqueId<'ModuleId'>()
export const ModuleVersionIdSchema = opaqueId<'ModuleVersionId'>()
export const ContractIdSchema = opaqueId<'ContractId'>()
export const EventIdSchema = opaqueId<'EventId'>()
export const MessageIdSchema = opaqueId<'MessageId'>()
export const ReviewIdSchema = opaqueId<'ReviewId'>()
export const ApprovalIdSchema = opaqueId<'ApprovalId'>()
export const CheckpointIdSchema = opaqueId<'CheckpointId'>()
export const AuditIdSchema = opaqueId<'AuditId'>()

export type ProjectId = z.infer<typeof ProjectIdSchema>
export type PlanId = z.infer<typeof PlanIdSchema>
export type AgentId = z.infer<typeof AgentIdSchema>
export type TaskId = z.infer<typeof TaskIdSchema>
export type ModuleId = z.infer<typeof ModuleIdSchema>
export type ModuleVersionId = z.infer<typeof ModuleVersionIdSchema>
export type ContractId = z.infer<typeof ContractIdSchema>
export type EventId = z.infer<typeof EventIdSchema>
export type MessageId = z.infer<typeof MessageIdSchema>
export type ReviewId = z.infer<typeof ReviewIdSchema>
export type ApprovalId = z.infer<typeof ApprovalIdSchema>
export type CheckpointId = z.infer<typeof CheckpointIdSchema>
export type AuditId = z.infer<typeof AuditIdSchema>

/**
 * IDs de OpenCode y del actor humano no son IDs de dominio. Se mantienen como
 * strings verificados en el límite del adaptador.
 */
export const OpenCodeSessionIdSchema = z.string().min(1)
export type OpenCodeSessionId = z.infer<typeof OpenCodeSessionIdSchema>
