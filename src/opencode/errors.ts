export class OpenCodeAdapterError extends Error {
  readonly code: string
  override readonly cause?: unknown

  constructor(code: string, message: string, cause?: unknown) {
    super(message)
    this.name = 'OpenCodeAdapterError'
    this.code = code
    this.cause = cause
  }
}

export class ServiceUnavailableError extends OpenCodeAdapterError {
  constructor(message = 'No se encontró un servidor OpenCode V2 disponible', cause?: unknown) {
    super('SERVICE_UNAVAILABLE', message, cause)
    this.name = 'ServiceUnavailableError'
  }
}

export class SessionTimeoutError extends OpenCodeAdapterError {
  constructor(sessionID: string, timeoutMs: number) {
    super('SESSION_TIMEOUT', `La sesión ${sessionID} no terminó dentro de ${timeoutMs} ms`)
    this.name = 'SessionTimeoutError'
  }
}
