'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useMediaQuery } from 'usehooks-ts'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, NotePencil, UsersThree } from '@phosphor-icons/react'
import FeatureGate from '@components/Dashboard/Shared/FeatureGate/FeatureGate'
import AuthenticatedClientElement from '@components/Security/AuthenticatedClientElement'
import { messagingKeys, useMessaging, useMessagingEnabled } from '@components/Messaging/MessagingProvider'
import { useAgents, useOrgCourses } from '@components/Messaging/hooks'
import ConversationSidebar from '@components/Messaging/Sidebar/ConversationSidebar'
import Thread from '@components/Messaging/Thread/Thread'
import NewConversationDialog from '@components/Messaging/Dialogs/NewConversationDialog'
import BroadcastDialog from '@components/Messaging/Dialogs/BroadcastDialog'
import SettingsDialog from '@components/Messaging/Dialogs/SettingsDialog'
import AgentBuilderDialog from '@components/Messaging/Agents/AgentBuilderDialog'
import AgentAvatar from '@components/Messaging/Agents/AgentAvatar'
import AgentsGallery from '@components/Messaging/Agents/AgentsGallery'
import {
  Agent,
  Conversation,
  CourseCard,
  createConversation,
  listAgents,
  openAgentChat,
} from '@services/messaging/messaging'

function EmptyState({
  onNewMessage,
  onAgent,
  onNewAgent,
  defaultAgent,
}: {
  onNewMessage: () => void
  onAgent: (a: Agent) => void
  onNewAgent: () => void
  defaultAgent: Agent | undefined
}) {
  const { t } = useTranslation()
  // Each choice is a ruled row, like an entry in a table of contents.
  const option = (icon: React.ReactNode, title: string, desc: string, onClick: () => void) => (
    <button onClick={onClick} className="group flex w-full items-center gap-4 border-b border-gray-200 py-4 text-start">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-paper text-wine-900">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-gray-900 transition-colors group-hover:text-wine-900">{title}</span>
        <span className="block text-sm text-gray-500">{desc}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-wine-900" />
    </button>
  )
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-6 py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-wine-800">
          {t('messaging.empty_eyebrow', { defaultValue: 'Prakto Akademi' })}
        </p>
        <h2 className="mt-2 text-3xl text-gray-900">{t('messaging.empty_title', { defaultValue: 'Your messages' })}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
          {t('messaging.empty_desc', {
            defaultValue: 'Talk with classmates and teachers, follow course announcements, or ask an AI agent about anything you are learning.',
          })}
        </p>
        <div className="mt-8 border-t border-gray-200">
          {option(
            <NotePencil size={18} />,
            t('messaging.new_message', { defaultValue: 'New message' }),
            t('messaging.new_message_desc', { defaultValue: 'Message someone or start a group' }),
            onNewMessage
          )}
          {defaultAgent &&
            option(
              <AgentAvatar agent={defaultAgent} size={24} />,
              t('messaging.ask_named', { defaultValue: 'Ask {{name}}', name: defaultAgent.name }),
              t('messaging.ask_named_desc', { defaultValue: 'Answers with sources from your courses' }),
              () => onAgent(defaultAgent)
            )}
          {option(
            <UsersThree size={18} />,
            t('messaging.build_agent', { defaultValue: 'Build an agent' }),
            t('messaging.build_agent_desc', { defaultValue: 'Your own tutor, with its own style' }),
            onNewAgent
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * On phones an open chat (or the agents gallery) covers the whole screen,
 * header and tab bar included, like a native messenger. It is portaled to the
 * body because the page content sits in its own stacking context, and it
 * follows the visual viewport so the composer rides on top of the keyboard.
 */
function PhoneScreen({ children }: { children: React.ReactNode }) {
  const [vv, setVv] = useState<{ top: number; height: number } | null>(null)
  useEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const update = () => setVv({ top: v.offsetTop, height: v.height })
    update()
    v.addEventListener('resize', update)
    v.addEventListener('scroll', update)
    return () => {
      v.removeEventListener('resize', update)
      v.removeEventListener('scroll', update)
    }
  }, [])
  // The page behind must not scroll while the screen is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])
  return createPortal(
    <div
      className="fixed inset-x-0 top-0 flex flex-col bg-white pt-[var(--lh-safe-top)] pb-[var(--lh-safe-bottom)]"
      style={{ zIndex: 'var(--z-nav-menu)', top: vv?.top ?? 0, height: vv ? vv.height : '100dvh' }}
    >
      {children}
    </div>,
    document.body
  )
}

function MessagesApp({ orgslug }: { orgslug: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const qc = useQueryClient()
  const { orgId, token } = useMessaging()
  const { data: agents = [] } = useAgents()
  const selected = params.get('c')
  const focus = params.get('m')
  const shareUuid = params.get('share')
  const showAgents = params.get('agents') === '1'

  const [newOpen, setNewOpen] = useState(false)
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(params.get('settings') === 'notifications')
  const [builder, setBuilder] = useState<{ open: boolean; agent: Agent | null }>({ open: false, agent: null })
  const [shareCourse, setShareCourse] = useState<CourseCard | null>(null)
  const handled = useRef<string>('')

  const setQuery = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (v === null) sp.delete(k)
        else sp.set(k, v)
      }
      const qs = sp.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    },
    [params, pathname, router]
  )

  const select = useCallback(
    (uuid: string | null, focusMessage?: string) =>
      setQuery({ c: uuid, m: focusMessage ?? null, agent: null, agents: null, to: null, share: null, settings: null }),
    [setQuery]
  )

  const openConversation = useCallback(
    (c: Conversation) => {
      qc.invalidateQueries({ queryKey: messagingKeys.conversations(orgId ?? 0) })
      select(c.conversation_uuid)
    },
    [qc, orgId, select]
  )

  const openAgent = useCallback(
    async (agentUuid: string, fresh = false) => {
      if (!token) return
      const conv = await openAgentChat(agentUuid, token, fresh)
      if (fresh) qc.removeQueries({ queryKey: messagingKeys.messages(conv.conversation_uuid) })
      openConversation(conv)
    },
    [token, openConversation, qc]
  )

  // Deep links: ?agent=, ?to=, ?share=
  const { data: courses = [] } = useOrgCourses(orgslug, Boolean(shareUuid))
  useEffect(() => {
    if (!token || !orgId) return
    const agentParam = params.get('agent')
    const toParam = params.get('to')
    const key = `${agentParam}|${toParam}`
    if ((agentParam || toParam) && handled.current !== key) {
      handled.current = key
      ;(async () => {
        try {
          if (agentParam) {
            let uuid = agentParam
            if (agentParam === 'default') {
              const list = await listAgents(orgId, token)
              uuid = list.find((a) => a.is_default)?.agent_uuid || list[0]?.agent_uuid
            }
            if (uuid) await openAgent(uuid)
          } else if (toParam) {
            const conv = await createConversation({ org_id: orgId, kind: 'dm', user_uuids: [toParam] }, token)
            openConversation(conv)
          }
        } catch {
          setQuery({ agent: null, to: null })
        }
      })()
    }
  }, [params, token, orgId, openAgent, openConversation, setQuery])

  useEffect(() => {
    if (!shareUuid || !courses.length) return
    const c = courses.find((x) => x.course_uuid === shareUuid || x.course_uuid === `course_${shareUuid}`)
    if (c) {
      setShareCourse({ course_uuid: c.course_uuid, name: c.name, description: c.description || '', thumbnail_image: c.thumbnail_image || '' })
      setNewOpen(true)
    }
  }, [shareUuid, courses])

  useEffect(() => {
    if (params.get('settings') === 'notifications') setSettingsOpen(true)
  }, [params])

  const defaultAgent = useMemo(() => agents.find((a) => a.is_default), [agents])
  const isPhone = useMediaQuery('(max-width: 767px)', { initializeWithValue: false })
  // Phones show either the list or one full-screen detail view.
  const detail = Boolean(selected || showAgents)

  const thread = selected ? (
    <Thread
      key={selected}
      uuid={selected}
      orgslug={orgslug}
      focusMessageUuid={focus}
      onBack={() => select(null)}
      onLeft={() => select(null)}
      onOpenConversation={openConversation}
      onEditAgent={(agent) => setBuilder({ open: true, agent })}
      onNewAgentChat={(uuid) => openAgent(uuid, true)}
    />
  ) : showAgents ? (
    <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8">
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => setQuery({ agents: null })}
          className="md:hidden -ms-1.5 flex h-10 w-10 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label={t('messaging.back', { defaultValue: 'Back' })}
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="text-2xl text-gray-900">{t('messaging.agents', { defaultValue: 'Agents' })}</h2>
      </div>
      <p className="mt-2 mb-6 text-sm text-gray-500">
        {t('messaging.agents_desc', { defaultValue: 'Assistants that answer from your courses, each with its own style.' })}
      </p>
      <AgentsGallery orgslug={orgslug} onOpenChat={openConversation} />
    </div>
  ) : (
    <EmptyState
      onNewMessage={() => setNewOpen(true)}
      onAgent={(a) => openAgent(a.agent_uuid)}
      onNewAgent={() => setBuilder({ open: true, agent: null })}
      defaultAgent={defaultAgent}
    />
  )

  return (
    // Phones: the list fills the space between the 60px header and the tab bar.
    <div className="flex h-[calc(100dvh-60px-var(--lh-mobile-nav-h))] md:h-[calc(100dvh-72px)] w-full max-w-(--breakpoint-2xl) mx-auto px-0 sm:px-4 md:px-6 lg:px-8 gap-3 md:py-5">
      <aside
        className={`${detail ? 'hidden md:flex' : 'flex'} max-md:pb-[var(--lh-safe-bottom)] w-full md:w-[340px] lg:w-[360px] flex-shrink-0 flex-col bg-white md:rounded-lg md:border md:border-gray-200 overflow-hidden`}
      >
        <ConversationSidebar
          orgslug={orgslug}
          selected={selected}
          onSelect={select}
          onNewMessage={() => {
            setShareCourse(null)
            setNewOpen(true)
          }}
          onAnnounce={() => setBroadcastOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onNewAgent={() => setBuilder({ open: true, agent: null })}
          onOpenAgentChat={openConversation}
        />
      </aside>

      {isPhone && detail ? (
        <PhoneScreen>{thread}</PhoneScreen>
      ) : (
        <section aria-label="Conversation" data-messages-thread className="hidden md:flex flex-1 min-w-0 flex-col bg-white md:rounded-lg md:border md:border-gray-200 overflow-hidden">
          {thread}
        </section>
      )}

      <NewConversationDialog
        open={newOpen}
        onOpenChange={(o) => {
          setNewOpen(o)
          if (!o && shareUuid) setQuery({ share: null })
        }}
        shareCourse={shareCourse}
        onCreated={openConversation}
      />
      <BroadcastDialog open={broadcastOpen} onOpenChange={setBroadcastOpen} onSent={openConversation} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(o) => {
          setSettingsOpen(o)
          if (!o && params.get('settings')) setQuery({ settings: null })
        }}
      />
      <AgentBuilderDialog
        open={builder.open}
        agent={builder.agent}
        orgslug={orgslug}
        onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
        onSaved={(agent) => {
          qc.invalidateQueries({ queryKey: messagingKeys.agents(orgId ?? 0) })
          qc.invalidateQueries({ queryKey: ['messaging', 'agent', agent.agent_uuid] })
          if (!builder.agent) openAgent(agent.agent_uuid)
        }}
      />
    </div>
  )
}

export default function MessagesClient({ orgslug }: { orgslug: string }) {
  const enabled = useMessagingEnabled()
  return (
    <AuthenticatedClientElement checkMethod="authentication">
      {enabled ? (
        <MessagesApp orgslug={orgslug} />
      ) : (
        <div className="max-w-3xl mx-auto px-4 py-16">
          <FeatureGate feature="messaging" orgslug={orgslug} context="public">
            <MessagesApp orgslug={orgslug} />
          </FeatureGate>
        </div>
      )}
    </AuthenticatedClientElement>
  )
}
