import { NextRequest, NextResponse } from 'next/server'
import {
  PRAKTO_PKCE_COOKIE,
  PRAKTO_PKCE_COOKIE_PATH,
  PRAKTO_STATE_MAX_AGE_MS,
  createPkcePair,
  getPraktoSsoConfig,
  isSecureRequest,
  isValidPraktoRedirectUri,
  signPraktoState,
} from '@/lib/auth/prakto-sso'

// Starts "Fortsätt med Prakto-konto": returns the Prakto authorize URL and keeps
// the PKCE verifier in an httpOnly cookie that only the token route receives.
export async function POST(request: NextRequest) {
  const config = getPraktoSsoConfig()
  if (!config) {
    return NextResponse.json({ error: 'Prakto sign-in is not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const redirectUri = body?.redirect_uri
  const clientState = body?.state

  if (!isValidPraktoRedirectUri(request, redirectUri)) {
    return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
  }
  if (
    !clientState ||
    typeof clientState.csrf !== 'string' ||
    !clientState.csrf ||
    typeof clientState.timestamp !== 'number'
  ) {
    return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
  }

  const state = signPraktoState(config, {
    csrf: clientState.csrf,
    callbackUrl: typeof clientState.callbackUrl === 'string' ? clientState.callbackUrl : undefined,
    timestamp: clientState.timestamp,
  })
  const { verifier, challenge } = createPkcePair()

  const authorizeUrl = new URL('/api/akademi/sso/authorize', config.praktoUrl)
  authorizeUrl.searchParams.set('client_id', config.clientId)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  const response = NextResponse.json({ url: authorizeUrl.toString() })
  response.cookies.set(PRAKTO_PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: PRAKTO_PKCE_COOKIE_PATH,
    maxAge: PRAKTO_STATE_MAX_AGE_MS / 1000,
  })
  return response
}
