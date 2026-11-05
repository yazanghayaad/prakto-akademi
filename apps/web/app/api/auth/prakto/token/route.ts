import { NextRequest, NextResponse } from 'next/server'
import { requestOriginHost } from '@/lib/auth/oauth-state'
import {
  PRAKTO_PKCE_COOKIE,
  PRAKTO_PKCE_COOKIE_PATH,
  getPraktoSsoConfig,
  isSecureRequest,
  isValidPraktoRedirectUri,
  verifyPraktoState,
} from '@/lib/auth/prakto-sso'

function clearPkceCookie(response: NextResponse, request: NextRequest): NextResponse {
  response.cookies.set(PRAKTO_PKCE_COOKIE, '', {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: 'lax',
    path: PRAKTO_PKCE_COOKIE_PATH,
    maxAge: 0,
  })
  return response
}

// Exchanges a Prakto authorization code for a short-lived Prakto access token.
// The client secret and PKCE verifier never reach the browser.
export async function POST(request: NextRequest) {
  const config = getPraktoSsoConfig()
  if (!config) {
    return NextResponse.json({ error: 'Prakto sign-in is not configured' }, { status: 503 })
  }

  const body = await request.json().catch(() => null)
  const code = body?.code
  const state = body?.state
  const redirectUri = body?.redirect_uri

  if (typeof code !== 'string' || !code || code.length > 4096) {
    return NextResponse.json({ error: 'Missing code' }, { status: 400 })
  }
  if (!isValidPraktoRedirectUri(request, redirectUri)) {
    return NextResponse.json({ error: 'Invalid redirect_uri' }, { status: 400 })
  }
  // Only redeem codes for flows this server started, from the same origin.
  if (!verifyPraktoState(config, state)) {
    return NextResponse.json({ error: 'Invalid or expired state' }, { status: 400 })
  }
  if (requestOriginHost(request) !== new URL(redirectUri).host.toLowerCase()) {
    return NextResponse.json({ error: 'Origin mismatch' }, { status: 403 })
  }

  const verifier = request.cookies.get(PRAKTO_PKCE_COOKIE)?.value
  if (!verifier) {
    return NextResponse.json(
      { error: 'The sign-in took too long or was started in another tab. Please try again.' },
      { status: 400 },
    )
  }

  let praktoResponse: Response
  try {
    praktoResponse = await fetch(new URL('/api/akademi/sso/token', config.praktoUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code_verifier: verifier,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    console.error('Prakto token exchange failed:', error)
    return clearPkceCookie(
      NextResponse.json({ error: 'Could not reach Prakto. Please try again.' }, { status: 502 }),
      request,
    )
  }

  // Prakto answers with its { data } / { error: { code, message } } envelope.
  const payload = await praktoResponse.json().catch(() => null)
  const accessToken = payload?.data?.access_token
  const email = payload?.data?.email
  if (!praktoResponse.ok || typeof accessToken !== 'string' || typeof email !== 'string') {
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : 'Token exchange failed'
    console.error('Prakto token exchange rejected:', praktoResponse.status, payload?.error?.code)
    return clearPkceCookie(
      NextResponse.json({ error: message }, { status: praktoResponse.ok ? 502 : 400 }),
      request,
    )
  }

  return clearPkceCookie(NextResponse.json({ access_token: accessToken, email }), request)
}
