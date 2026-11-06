import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { createId } from '../domain/id-factory.js'
import { PrincipalSchema } from './types.js'
import type { Principal } from './types.js'

const TokenPayloadSchema = PrincipalSchema.and(
  z.object({
    exp: z.number().int().positive(),
    jti: z.string().min(1),
    iat: z.number().int().positive(),
  }),
)
export type TokenPayload = z.infer<typeof TokenPayloadSchema>

export class TokenError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'TokenError'
    this.code = code
  }
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

/**
 * Tokens HMAC-SHA256 emitidos por el servidor. El rol nunca se toma de un
 * mensaje o prompt: se toma de este token firmado y, para agentes, se
 * contrasta de nuevo con la base de datos en AuthorizationService.
 */
export class TokenService {
  private readonly secret: string
  private readonly now: () => number

  constructor(secret: string, options: { now?: () => number } = {}) {
    if (secret.length < 16) {
      throw new TokenError('WEAK_SECRET', 'ORCH_AUTH_SECRET must have at least 16 characters')
    }
    this.secret = secret
    this.now = options.now ?? (() => Date.now())
  }

  issue(principal: Principal, ttlSeconds = 3600): string {
    const parsed = PrincipalSchema.safeParse(principal)
    if (!parsed.success) {
      throw new TokenError(
        'INVALID_PRINCIPAL',
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    const issuedAt = Math.floor(this.now() / 1000)
    const payload: TokenPayload = {
      ...parsed.data,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      jti: createId('tok'),
    }
    const encodedPayload = base64UrlEncode(JSON.stringify(payload))
    const signature = this.sign(encodedPayload)
    return `v1.${encodedPayload}.${signature}`
  }

  verify(token: string): TokenPayload {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1') {
      throw new TokenError('INVALID_TOKEN', 'Invalid token format')
    }
    const [, encodedPayload, signature] = parts
    if (!encodedPayload || !signature) {
      throw new TokenError('INVALID_TOKEN', 'Invalid token format')
    }

    const expected = this.sign(encodedPayload)
    const expectedBuffer = Buffer.from(expected)
    const actualBuffer = Buffer.from(signature)
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new TokenError('INVALID_SIGNATURE', 'Invalid token signature')
    }

    let payload: unknown
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload))
    } catch {
      throw new TokenError('INVALID_TOKEN', 'Invalid token payload')
    }

    const parsed = TokenPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new TokenError('INVALID_TOKEN', 'Invalid token payload shape')
    }
    if (parsed.data.exp <= Math.floor(this.now() / 1000)) {
      throw new TokenError('TOKEN_EXPIRED', 'Token expired')
    }
    return parsed.data
  }

  private sign(encodedPayload: string): string {
    return createHmac('sha256', this.secret).update(encodedPayload).digest('base64url')
  }
}
