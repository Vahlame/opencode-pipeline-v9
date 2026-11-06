export class OrchestratorError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'OrchestratorError'
    this.code = code
    this.status = status
  }
}

export class NotFoundError extends OrchestratorError {
  constructor(message: string) {
    super('NOT_FOUND', message, 404)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends OrchestratorError {
  constructor(message: string) {
    super('CONFLICT', message, 409)
    this.name = 'ConflictError'
  }
}

export class ValidationError extends OrchestratorError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message, 400)
    this.name = 'ValidationError'
  }
}

export class PolicyError extends OrchestratorError {
  constructor(message: string) {
    super('POLICY_ERROR', message, 403)
    this.name = 'PolicyError'
  }
}
