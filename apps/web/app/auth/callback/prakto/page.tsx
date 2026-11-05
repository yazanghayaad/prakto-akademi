'use client'

// Callback for "Fortsätt med Prakto-konto" (see lib/auth/prakto-sso.ts).
// Mirrors the Google callback without the custom-domain bounce: the flow always
// starts and ends on this origin.
import React, { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { useAuth, validateOAuthState } from '@components/Contexts/AuthContext'
import { getErrorMessage } from '@services/utils/ts/errorMessage'

// error_description values Prakto's authorize endpoint sends with access_denied.
const PRAKTO_ERROR_KEYS: Record<string, string> = {
  email_not_verified: 'auth.prakto_callback.email_not_verified',
  account_blocked: 'auth.prakto_callback.account_blocked',
}

export default function PraktoCallbackPage() {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'csrf_error'>('loading')
  // The code is redeemed once: a second effect run (StrictMode) must not retry it.
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    const callbackKey = searchParams.toString()
    if (handledRef.current === callbackKey) return
    handledRef.current = callbackKey

    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')
      const errorDescription = searchParams.get('error_description')

      if (errorParam) {
        const knownKey = errorDescription ? PRAKTO_ERROR_KEYS[errorDescription] : undefined
        setError(
          knownKey
            ? t(knownKey)
            : t('auth.prakto_callback.provider_failed', { error: errorDescription || errorParam })
        )
        setStatus('error')
        return
      }

      if (!code) {
        setError(t('auth.prakto_callback.no_code'))
        setStatus('error')
        return
      }

      if (!state) {
        setError(t('auth.google_callback.missing_state'))
        setStatus('csrf_error')
        return
      }

      // CSRF: the state must carry the nonce this browser stored when it started.
      // The token route verifies the state's signature server-side.
      const stateValidation = validateOAuthState(state)
      if (!stateValidation.valid) {
        setError(t('auth.google_callback.invalid_request'))
        setStatus('csrf_error')
        return
      }
      const callbackUrl = stateValidation.callbackUrl

      try {
        const tokenResponse = await fetch('/api/auth/prakto/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            state,
            redirect_uri: `${window.location.origin}/auth/callback/prakto`,
          }),
        })
        const tokenData = await tokenResponse.json().catch(() => ({}))
        if (!tokenResponse.ok || !tokenData.access_token) {
          throw new Error(
            typeof tokenData.error === 'string' && tokenData.error
              ? tokenData.error
              : t('auth.prakto_callback.exchange_failed')
          )
        }

        // Through the Next.js auth proxy so the session cookies are set here.
        const oauthResponse = await fetch('/api/auth/oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: tokenData.email,
            provider: 'prakto',
            access_token: tokenData.access_token,
          }),
          credentials: 'include',
        })

        if (!oauthResponse.ok) {
          const errorData = await oauthResponse.json().catch(() => ({}))
          throw new Error(getErrorMessage(errorData.detail, t('auth.google_callback.authenticate_failed')))
        }

        const data = await oauthResponse.json()

        // An account with 2FA enrolled gets a challenge instead of a session;
        // the login page owns the code form.
        if (data.mfa_required && data.mfa_token) {
          const mfaParams = new URLSearchParams({ mfa_token: data.mfa_token })
          router.push(`/auth/login?${mfaParams.toString()}`)
          return
        }

        if (!data.tokens?.access_token) {
          throw new Error(t('auth.google_callback.invalid_server_response'))
        }

        const result = await signIn('credentials', {
          redirect: false,
          sso: 'true',
          sso_access_token: data.tokens.access_token,
          sso_user: JSON.stringify(data.user),
          sso_expiry: data.tokens.expiry,
          callbackUrl,
        })

        if (result && !result.ok) {
          throw new Error(result.error || t('auth.google_callback.signin_failed'))
        }

        setStatus('success')
        router.push(callbackUrl)
      } catch (err: any) {
        console.error('Prakto sign-in callback error:', err)
        setError(err.message || t('auth.google_callback.auth_failed'))
        setStatus('error')
      }
    }

    handleCallback()
  }, [searchParams, router, signIn, t])

  if (status === 'loading' || status === 'success') {
    const done = status === 'success'
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className={`w-12 h-12 animate-spin ${done ? 'text-green-600' : 'text-gray-600'}`} />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            {done ? t('auth.google_callback.success') : t('auth.google_callback.completing')}
          </h1>
          <p className="text-gray-500">
            {done ? t('auth.google_callback.redirecting') : t('auth.google_callback.please_wait')}
          </p>
        </div>
      </div>
    )
  }

  const isCsrf = status === 'csrf_error'
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md mx-auto p-6">
        <div className="flex justify-center mb-4">
          <div className={`p-3 rounded-full ${isCsrf ? 'bg-amber-100' : 'bg-red-100'}`}>
            {isCsrf ? (
              <ShieldAlert className="w-12 h-12 text-amber-600" />
            ) : (
              <AlertTriangle className="w-12 h-12 text-red-600" />
            )}
          </div>
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">
          {isCsrf ? t('auth.google_callback.security_failed') : t('auth.google_callback.auth_failed')}
        </h1>
        <p className={`text-gray-600 ${isCsrf ? 'mb-2' : 'mb-6'}`}>{error}</p>
        {isCsrf && (
          <p className="text-gray-500 text-sm mb-6">{t('auth.google_callback.security_hint')}</p>
        )}
        <div className="space-y-3">
          <Link
            href="/login"
            className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
          >
            {isCsrf ? t('auth.google_callback.go_to_login') : t('auth.google_callback.try_again')}
          </Link>
          <Link
            href="/"
            className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
          >
            {t('auth.google_callback.go_home')}
          </Link>
        </div>
      </div>
    </div>
  )
}
