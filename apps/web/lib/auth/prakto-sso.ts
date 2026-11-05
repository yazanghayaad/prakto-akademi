// Server-only helpers for "Fortsätt med Prakto-konto" (Prakto Akademi).
//
// Prakto is an OAuth 2.0 provider (authorization code + PKCE). The flow:
//   1. POST /api/auth/prakto/authorize → signed state + PKCE pair; the verifier
//      goes into an httpOnly cookie, the browser goes to Prakto.
//   2. Prakto redirects to /auth/callback/prakto?code&state.
//   3. POST /api/auth/prakto/token → exchanges the code (client secret + PKCE
//      verifier) for a short-lived Prakto access token.
//   4. The callback posts that token to /api/auth/oauth (provider "prakto"); the
//      API verifies it (apps/api/src/services/auth/prakto.py).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'
import { getConfig } from '@services/config/config'
import { requestOriginHost } from '@/lib/auth/oauth-state'

export const PRAKTO_CALLBACK_PATH = '/auth/callback/prakto'
export const PRAKTO_PKCE_COOKIE = 'LH_prakto_pkce'
export const PRAKTO_PKCE_COOKIE_PATH = '/api/auth/prakto'
export const PRAKTO_STATE_MAX_AGE_MS = 10 * 60 * 1000

export interface PraktoSsoConfig {
  praktoUrl: string
  clientId: string
  clientSecret: string
}

/** Null when Prakto sign-in is not configured on this deployment. */
export function getPraktoSsoConfig(): PraktoSsoConfig | null {
  // getConfig, not process.env: NEXT_PUBLIC_* would be inlined at build time.
  const praktoUrl = getConfig('NEXT_PUBLIC_PRAKTO_URL').replace(/\/+$/, '')
  const clientSecret = process.env.PRAKTO_SSO_CLIENT_SECRET || ''
  if (!praktoUrl || clientSecret.length < 32) return null
  return {
    praktoUrl,
    clientId: process.env.PRAKTO_SSO_CLIENT_ID || 'prakto-akademi',
    clientSecret,
  }
}

/** Our own callback, on the origin the request came from. */
export function isValidPraktoRedirectUri(request: NextRequest, redirectUri: unknown): redirectUri is string {
  if (typeof redirectUri !== 'string') return false
  try {
    const url = new URL(redirectUri)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === PRAKTO_CALLBACK_PATH &&
      url.search === '' &&
      url.host.toLowerCase() === requestOriginHost(request)
    )
  } catch {
    return false
  }
}

export function isSecureRequest(request: NextRequest): boolean {
  return request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:'
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// ── Signed state: base64url(payload).base64url(hmac), like oauth-state.ts ──

export interface PraktoStatePayload {
  // Client CSRF nonce, also stored in the LH_oauth_state cookie
  csrf: string
  callbackUrl?: string
  timestamp: number
  nonce: string
  iat: number
}

function stateKey(config: PraktoSsoConfig): Buffer {
  // Derived key, so the client secret never doubles as a MAC key.
  return createHmac('sha256', config.clientSecret).update('learnhouse/prakto-oauth-state/v1').digest()
}

function mac(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('base64url')
}

export function signPraktoState(
  config: PraktoSsoConfig,
  input: Pick<PraktoStatePayload, 'csrf' | 'callbackUrl' | 'timestamp'>,
): string {
  const payload: PraktoStatePayload = {
    csrf: input.csrf,
    callbackUrl: input.callbackUrl,
    timestamp: input.timestamp,
    nonce: randomBytes(16).toString('base64url'),
    iat: Date.now(),
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${mac(body, stateKey(config))}`
}

export function verifyPraktoState(config: PraktoSsoConfig, state: unknown): PraktoStatePayload | null {
  if (typeof state !== 'string') return null
  const dot = state.indexOf('.')
  if (dot <= 0 || dot !== state.lastIndexOf('.')) return null
  const body = state.slice(0, dot)
  const given = Buffer.from(state.slice(dot + 1), 'base64url')
  const expected = Buffer.from(mac(body, stateKey(config)), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PraktoStatePayload
    if (typeof payload.iat !== 'number' || typeof payload.csrf !== 'string') return null
    const age = Date.now() - payload.iat
    if (age < 0 || age > PRAKTO_STATE_MAX_AGE_MS) return null
    return payload
  } catch {
    return null
  }
}
