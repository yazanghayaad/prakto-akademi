'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { NotePencil, PencilSimple, Sparkle, Star, Trash } from '@phosphor-icons/react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { cn } from '@/lib/utils'
import AtlasChat from './AtlasChat'
import { atlasApi, AtlasSessionSummary } from './atlasApi'
import { useAtlasMini } from './AtlasMiniContext'

const K = 'dashboard.atlas.'
const DAY = 24 * 3600 * 1000

function groupSessions(sessions: AtlasSessionSummary[]) {
  const now = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const groups: Record<'favorites' | 'today' | 'previous_7_days' | 'older', AtlasSessionSummary[]> = {
    favorites: [],
    today: [],
    previous_7_days: [],
    older: [],
  }
  for (const s of sessions) {
    const at = new Date(s.updated_at).getTime()
    if (s.favorite) groups.favorites.push(s)
    else if (at >= startOfToday.getTime()) groups.today.push(s)
    else if (now - at < 7 * DAY) groups.previous_7_days.push(s)
    else groups.older.push(s)
  }
  return groups
}

export default function AtlasPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id
  const atlas = useAtlasMini()

  const [sessions, setSessions] = useState<AtlasSessionSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(searchParams.get('session'))
  const [listError, setListError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!orgId || !token) return
    atlasApi
      .listSessions(orgId, token)
      .then((list) => {
        setSessions(list)
        setListError(null)
      })
      .catch((e) => setListError(e?.message || 'error'))
  }, [orgId, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  // The side panel and this page are two views of Atlas; keep only one open.
  useEffect(() => {
    atlas.setOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const select = (id: string | null) => {
    setActiveId(id)
    router.replace(id ? `/dash/atlas?session=${id}` : '/dash/atlas')
  }

  const onSessionChange = (id: string, title: string) => {
    if (id !== activeId) select(id)
    setSessions((prev) => {
      const exists = prev.find((s) => s.id === id)
      const now = new Date().toISOString()
      if (exists) return prev.map((s) => (s.id === id ? { ...s, title: title || s.title, updated_at: now } : s))
      return [{ id, title, favorite: false, created_at: now, updated_at: now }, ...prev]
    })
  }

  const rename = async (s: AtlasSessionSummary) => {
    const title = window.prompt(t(`${K}rename`), s.title || '')
    if (title === null || !orgId || !token) return
    await atlasApi.patchSession(orgId, token, s.id, { title })
    refresh()
  }

  const toggleFavorite = async (s: AtlasSessionSummary) => {
    if (!orgId || !token) return
    await atlasApi.patchSession(orgId, token, s.id, { favorite: !s.favorite })
    refresh()
  }

  const remove = async (s: AtlasSessionSummary) => {
    if (!orgId || !token) return
    if (!window.confirm(t(`${K}delete_confirm`, { title: s.title || t(`${K}untitled`) }))) return
    await atlasApi.deleteSession(orgId, token, s.id)
    if (s.id === activeId) select(null)
    refresh()
  }

  const groups = useMemo(() => groupSessions(sessions), [sessions])

  if (!atlas.available) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-gray-500">
        {t(`${K}starting`)}
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 w-full bg-white">
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-e border-gray-100 bg-[#fafafa]">
        <div className="flex items-center gap-2 px-4 pt-5 pb-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-900 text-white">
            <Sparkle size={16} weight="fill" />
          </div>
          <span className="text-base font-semibold text-gray-900">{t(`${K}title`)}</span>
        </div>
        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => select(null)}
            className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <NotePencil size={16} /> {t(`${K}new_chat`)}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t(`${K}chats`)}</div>
          {listError && <p className="px-2 py-2 text-xs text-red-500">{listError}</p>}
          {!listError && sessions.length === 0 && <p className="px-2 py-2 text-xs text-gray-400">{t(`${K}no_chats`)}</p>}
          {(['favorites', 'today', 'previous_7_days', 'older'] as const).map((g) =>
            groups[g].length ? (
              <div key={g} className="mt-3">
                <div className="px-2 pb-1 text-xs font-medium text-gray-500">{t(`${K}groups.${g}`)}</div>
                {groups[g].map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm',
                      s.id === activeId ? 'bg-gray-200/70 text-gray-900' : 'text-gray-700 hover:bg-gray-100'
                    )}
                  >
                    <button type="button" onClick={() => select(s.id)} className="min-w-0 flex-1 truncate text-start">
                      {s.title || t(`${K}untitled`)}
                    </button>
                    <div className={cn('flex shrink-0 items-center gap-0.5', s.favorite ? '' : 'opacity-0 group-hover:opacity-100')}>
                      <button
                        type="button"
                        title={t(s.favorite ? `${K}unfavorite` : `${K}favorite`)}
                        onClick={() => toggleFavorite(s)}
                        className="rounded p-1 text-gray-400 hover:text-amber-500"
                      >
                        <Star size={14} weight={s.favorite ? 'fill' : 'regular'} className={s.favorite ? 'text-amber-500' : ''} />
                      </button>
                      <button
                        type="button"
                        title={t(`${K}rename`)}
                        onClick={() => rename(s)}
                        className="hidden rounded p-1 text-gray-400 hover:text-gray-800 group-hover:block"
                      >
                        <PencilSimple size={14} />
                      </button>
                      <button
                        type="button"
                        title={t(`${K}delete`)}
                        onClick={() => remove(s)}
                        className="hidden rounded p-1 text-gray-400 hover:text-red-600 group-hover:block"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <AtlasChat sessionId={activeId} onSessionChange={onSessionChange} pageContext={atlas.pageContext} />
      </main>
    </div>
  )
}
