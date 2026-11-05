'use client'
import React, { useState } from 'react'
import '../lib/i18n'
import { SessionProvider } from '@components/Contexts/AuthContext'
import LHSessionProvider from '@components/Contexts/LHSessionContext'
import AuthFetchInterceptor from '@components/Contexts/AuthFetchInterceptor'
import PostHogProvider from '@components/Contexts/PostHogProvider'
import I18nProvider from '@components/Contexts/I18nContext'
import DirectionProvider from '@components/Contexts/DirectionProvider'
import { BackgroundTasksProvider } from '@components/Contexts/BackgroundTasksContext'
import BackgroundTasksPanel from '@components/BackgroundTasks/BackgroundTasksPanel'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { makeQueryClient } from '@/lib/query/client'

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider refetchInterval={600000}>
        <AuthFetchInterceptor />
        <LHSessionProvider>
          <PostHogProvider>
            <I18nProvider>
              {/* Inside I18nProvider so it re-renders when the language changes. */}
              <DirectionProvider>
                <BackgroundTasksProvider>
                  {children}
                  <BackgroundTasksPanel />
                </BackgroundTasksProvider>
              </DirectionProvider>
            </I18nProvider>
          </PostHogProvider>
        </LHSessionProvider>
      </SessionProvider>
      {/* Opt-in: the floating devtools button sat on every page in local dev. */}
      {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_QUERY_DEVTOOLS === '1' && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
