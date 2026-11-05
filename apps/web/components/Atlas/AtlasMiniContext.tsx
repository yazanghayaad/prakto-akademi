'use client'

// Atlas side panel state, shared by the dashboard and the course editor:
// open/close, the shared input, the page the user is looking at and the
// chapters/activities they attached. Renders the side panel when open.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { ArrowsOutSimple, NotePencil, Sparkle, X } from '@phosphor-icons/react'
import useAdminStatus from '@components/Hooks/useAdminStatus'
import useGetAIFeatures from '@components/Hooks/useGetAIFeatures'
import AtlasChat from './AtlasChat'
import type { AtlasMiniContextValue, AtlasPageContext, AtlasReference } from './types'

export type { AtlasMiniContextValue, AtlasPageContext, AtlasReference } from './types'

const K = 'dashboard.atlas.'
const PANEL_SESSION_KEY = 'atlas_panel_session'

const noop = () => {}
const ATLAS_OFF: AtlasMiniContextValue = {
  available: false,
  open: false,
  setOpen: noop,
  toggle: noop,
  input: '',
  setInput: noop,
  appendToInput: noop,
  focusInput: noop,
  registerInputRef: noop,
  pageContext: null,
  setPageContext: noop,
  attachedReferences: [],
  attachReference: noop,
  removeReference: noop,
  clearReferences: noop,
}

const AtlasMiniCtx = createContext<AtlasMiniContextValue>(ATLAS_OFF)

export function useAtlasMini(): AtlasMiniContextValue {
  return useContext(AtlasMiniCtx)
}

/** Tell Atlas what the user is looking at while the calling component is mounted. */
export function useRegisterAtlasPageContext(ctx: AtlasPageContext | null) {
  const { setPageContext } = useAtlasMini()
  const key = JSON.stringify(ctx)
  useEffect(() => {
    setPageContext(ctx)
    return () => setPageContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setPageContext])
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

export function AtlasMiniProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAdminStatus() as any
  const aiEnabled = useGetAIFeatures({ feature: 'editor' })
  const available = isAdmin === true && aiEnabled === true

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [pageContext, setPageContextState] = useState<AtlasPageContext | null>(null)
  const [attachedReferences, setAttachedReferences] = useState<AtlasReference[]>([])
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const setPageContext = useCallback((ctx: AtlasPageContext | null) => setPageContextState(ctx), [])
  const focusInput = useCallback(() => setTimeout(() => inputRef.current?.focus(), 0), [])
  const registerInputRef = useCallback((el: HTMLTextAreaElement | null) => {
    inputRef.current = el
  }, [])
  const appendToInput = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev.trimEnd()} ${text}` : text))
  }, [])
  const attachReference = useCallback((ref: AtlasReference) => {
    setAttachedReferences((prev) => (prev.some((r) => r.uuid === ref.uuid) ? prev : [...prev, ref]))
    setOpen(true)
  }, [])
  const removeReference = useCallback(
    (uuid: string) => setAttachedReferences((prev) => prev.filter((r) => r.uuid !== uuid)),
    []
  )
  const clearReferences = useCallback(() => setAttachedReferences([]), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])

  const value = useMemo<AtlasMiniContextValue>(
    () =>
      available
        ? {
            available,
            open,
            setOpen,
            toggle,
            input,
            setInput,
            appendToInput,
            focusInput,
            registerInputRef,
            pageContext,
            setPageContext,
            attachedReferences,
            attachReference,
            removeReference,
            clearReferences,
          }
        : { ...ATLAS_OFF, setPageContext },
    [available, open, toggle, input, appendToInput, focusInput, registerInputRef, pageContext, setPageContext,
      attachedReferences, attachReference, removeReference, clearReferences]
  )

  return (
    <AtlasMiniCtx.Provider value={value}>
      {children}
      {available && open && <AtlasSidePanel />}
    </AtlasMiniCtx.Provider>
  )
}

function AtlasSidePanel() {
  const { t } = useTranslation()
  const atlas = useAtlasMini()
  const [sessionId, setSessionId] = useState<string | null>(() => readStored(PANEL_SESSION_KEY))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && atlas.setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [atlas])

  const ctx = atlas.pageContext
  const suggestions = ctx?.activity_uuid
    ? ['activity_shorter', 'activity_friendlier', 'activity_quiz', 'activity_translate']
    : ctx?.course_uuid
      ? ['course_summarize', 'course_add_chapter', 'course_reorder', 'course_publish_all']
      : ['home_recent', 'home_drafts', 'home_plan']

  return (
    <aside
      className="fixed inset-y-0 end-0 z-[60] flex w-full max-w-[440px] flex-col border-s border-gray-200 bg-white shadow-2xl"
      aria-label={t(`${K}title`)}
    >
      <header className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-900 text-white">
          <Sparkle size={15} weight="fill" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900">{t(`${K}title`)}</div>
          {(ctx?.activity_name || ctx?.course_name) && (
            <div className="truncate text-xs text-gray-500">
              {t(`${K}focus.label`)}: {ctx?.activity_name || ctx?.course_name}
            </div>
          )}
        </div>
        <button
          type="button"
          title={t(`${K}new_chat`)}
          onClick={() => {
            setSessionId(null)
            writeStored(PANEL_SESSION_KEY, null)
          }}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          <NotePencil size={18} />
        </button>
        <Link
          href={`/dash/atlas${sessionId ? `?session=${sessionId}` : ''}`}
          title={t(`${K}open`)}
          onClick={() => atlas.setOpen(false)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          <ArrowsOutSimple size={18} />
        </Link>
        <button
          type="button"
          title={t(`${K}close`)}
          onClick={() => atlas.setOpen(false)}
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
        >
          <X size={18} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <AtlasChat
          compact
          sessionId={sessionId}
          onSessionChange={(id) => {
            setSessionId(id)
            writeStored(PANEL_SESSION_KEY, id)
          }}
          pageContext={ctx}
          references={atlas.attachedReferences}
          onRemoveReference={atlas.removeReference}
          onReferencesSent={atlas.clearReferences}
          suggestions={suggestions.map((k) => t(`${K}quick_actions.${k}`))}
          input={atlas.input}
          setInput={atlas.setInput}
          registerInputRef={atlas.registerInputRef}
        />
      </div>
    </aside>
  )
}
