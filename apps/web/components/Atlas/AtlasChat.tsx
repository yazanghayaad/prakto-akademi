'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  CheckCircle,
  CircleNotch,
  HourglassMedium,
  Sparkle,
  Stop,
  X,
  XCircle,
} from '@phosphor-icons/react'
import AIMarkdownRenderer from '@components/Objects/Activities/AI/AIMarkdownRenderer'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { cn } from '@/lib/utils'
import { atlasApi, AtlasBlock, AtlasLink, AtlasProposal, AtlasStreamEvent } from './atlasApi'
import type { AtlasPageContext, AtlasReference } from './types'

const K = 'dashboard.atlas.'

export interface AtlasChatProps {
  sessionId: string | null
  /** Called when a chat is created on the first message, and when its title changes. */
  onSessionChange: (id: string, title: string) => void
  compact?: boolean
  pageContext?: AtlasPageContext | null
  references?: AtlasReference[]
  onRemoveReference?: (uuid: string) => void
  onReferencesSent?: () => void
  /** Suggestions shown while the chat is empty. */
  suggestions?: string[]
  /** Optional controlled input (shared with the side panel context). */
  input?: string
  setInput?: (v: string) => void
  registerInputRef?: (el: HTMLTextAreaElement | null) => void
}

function humanize(name: string) {
  const s = name.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function AtlasChat(props: AtlasChatProps) {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const token: string | undefined = session?.data?.tokens?.access_token
  const orgId: number | undefined = org?.id

  const [blocks, setBlocks] = useState<AtlasBlock[]>([])
  const [streaming, setStreaming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [localInput, setLocalInput] = useState('')
  const input = props.input ?? localInput
  const setInput = props.setInput ?? setLocalInput

  const abortRef = useRef<AbortController | null>(null)
  const skipLoadRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Load the chat when another one is selected.
  useEffect(() => {
    if (!props.sessionId) {
      setBlocks([])
      return
    }
    if (skipLoadRef.current === props.sessionId) return
    if (!orgId || !token) return
    let cancelled = false
    setLoading(true)
    atlasApi
      .getSession(orgId, token, props.sessionId)
      .then((s) => !cancelled && setBlocks(s.transcript || []))
      .catch(() => !cancelled && setBlocks([{ type: 'notice', text: t(`${K}errors.load_chat`) }]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [props.sessionId, orgId, token, t])

  // Keep the latest message in view.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [blocks, streaming])

  useEffect(() => () => abortRef.current?.abort(), [])

  const applyEvent = useCallback((event: AtlasStreamEvent) => {
    setBlocks((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      switch (event.type) {
        case 'text':
          if (last && last.type === 'text') next[next.length - 1] = { ...last, text: last.text + event.delta }
          else next.push({ type: 'text', text: event.delta })
          return next
        case 'tool_start':
          next.push({ type: 'tool', id: event.id, name: event.name, args: event.args, status: 'running' })
          return next
        case 'tool_end':
          return next.map((b) =>
            b.type === 'tool' && b.id === event.id
              ? { ...b, status: event.status, error: event.error, links: event.links }
              : b
          )
        case 'proposal':
          next.push({ type: 'proposal', ...event.proposal })
          return next
        case 'error':
          next.push({ type: 'notice', text: event.message })
          return next
        default:
          return prev
      }
    })
  }, [])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || streaming || !orgId || !token) return
      let id = props.sessionId
      setStreaming(true)
      setInput('')
      const refs = props.references || []
      setBlocks((prev) => [...prev, { type: 'user', text, references: refs }])
      try {
        if (!id) {
          const created = await atlasApi.createSession(orgId, token)
          id = created.id
          skipLoadRef.current = id
          props.onSessionChange(id, '')
        }
        const controller = new AbortController()
        abortRef.current = controller
        props.onReferencesSent?.()
        await atlasApi.sendMessage(
          orgId,
          token,
          id,
          { text, page_context: props.pageContext || null, references: refs },
          (event) => {
            if (event.type === 'start' || event.type === 'done') {
              if (event.title) props.onSessionChange(id as string, event.title)
              return
            }
            applyEvent(event)
          },
          controller.signal
        )
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          setBlocks((prev) => [...prev, { type: 'notice', text: 'stopped' }])
        } else {
          setBlocks((prev) => [
            ...prev,
            { type: 'notice', text: `${t(`${K}errors.stream_failed`)} ${e?.message || ''}`.trim() },
          ])
        }
      } finally {
        abortRef.current = null
        setStreaming(false)
        setTimeout(() => textareaRef.current?.focus(), 0)
      }
    },
    [streaming, orgId, token, props, setInput, applyEvent, t]
  )

  const stop = () => abortRef.current?.abort()

  const updateProposal = (p: AtlasProposal) =>
    setBlocks((prev) => prev.map((b) => (b.type === 'proposal' && b.id === p.id ? { type: 'proposal', ...p } : b)))

  const onApply = async (p: AtlasProposal) => {
    if (!orgId || !token) return
    updateProposal({ ...p, status: 'pending', error: '__applying__' })
    try {
      updateProposal(await atlasApi.applyProposal(orgId, token, p.id))
    } catch (e: any) {
      updateProposal({ ...p, status: 'failed', error: e?.message || t(`${K}action.apply_failed`) })
    }
  }

  const onCancel = async (p: AtlasProposal) => {
    if (!orgId || !token) return
    try {
      updateProposal(await atlasApi.cancelProposal(orgId, token, p.id))
    } catch (e: any) {
      updateProposal({ ...p, error: e?.message || t(`${K}action.cancel_failed`) })
    }
  }

  const last = blocks[blocks.length - 1]
  const showThinking = streaming && (!last || last.type === 'user' || last.type === 'tool')
  const empty = !loading && blocks.length === 0

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className={cn('flex-1 min-h-0 overflow-y-auto', props.compact ? 'px-4 py-4' : 'px-6 py-8')}>
        <div className={cn('mx-auto space-y-4', props.compact ? 'max-w-full' : 'max-w-3xl')}>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <CircleNotch className="animate-spin" size={16} /> {t(`${K}loading_chat`)}
            </div>
          )}
          {empty && <EmptyState compact={props.compact} suggestions={props.suggestions} onPick={send} />}
          {blocks.map((block, i) => (
            <Block
              key={i}
              block={block}
              streaming={streaming && i === blocks.length - 1}
              onApply={onApply}
              onCancel={onCancel}
            />
          ))}
          {showThinking && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Sparkle size={16} weight="fill" className="animate-pulse text-gray-500" /> {t(`${K}thinking`)}
            </div>
          )}
        </div>
      </div>

      <div className={cn('border-t border-gray-100 bg-white', props.compact ? 'p-3' : 'px-6 py-4')}>
        <div className={cn('mx-auto', props.compact ? 'max-w-full' : 'max-w-3xl')}>
          {(props.references?.length || 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {props.references!.map((r) => (
                <span
                  key={r.uuid}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
                >
                  <span className="text-gray-400">{t(`${K}reference_types.${r.type}`)}:</span>
                  <span className="max-w-[180px] truncate">{r.name}</span>
                  <button
                    type="button"
                    aria-label={t(`${K}remove_reference`)}
                    onClick={() => props.onRemoveReference?.(r.uuid)}
                    className="text-gray-400 hover:text-gray-700"
                  >
                    <X size={12} weight="bold" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm focus-within:border-gray-400">
            <textarea
              ref={(el) => {
                textareaRef.current = el
                props.registerInputRef?.(el)
              }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  send(input)
                }
              }}
              rows={1}
              placeholder={t(props.compact ? `${K}placeholder_short` : `${K}placeholder`)}
              className="flex-1 resize-none bg-transparent py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 max-h-48 field-sizing-content"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label={t(`${K}stop`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700"
              >
                <Stop size={14} weight="fill" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send(input)}
                disabled={!input.trim()}
                aria-label={t(`${K}send`)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-400"
              >
                <ArrowUp size={16} weight="bold" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ compact, suggestions, onPick }: { compact?: boolean; suggestions?: string[]; onPick: (s: string) => void }) {
  const { t } = useTranslation()
  const items = suggestions?.length
    ? suggestions
    : [
        t(`${K}empty.prompt_create_course`),
        t(`${K}empty.prompt_recent_courses`),
        t(`${K}empty.prompt_add_quiz`),
        t(`${K}empty.prompt_publish_all`),
      ]
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'pt-6' : 'pt-16')}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-900 text-white shadow-md">
        <Sparkle size={24} weight="fill" />
      </div>
      <h2 className={cn('mt-4 font-semibold text-gray-900', compact ? 'text-base' : 'text-xl')}>
        {t(`${K}empty.title`)}
      </h2>
      {!compact && <p className="mt-2 max-w-md text-sm text-gray-500">{t(`${K}empty.description`)}</p>}
      <div className={cn('mt-6 grid w-full gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
        {items.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-start text-sm text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function Block({
  block,
  streaming,
  onApply,
  onCancel,
}: {
  block: AtlasBlock
  streaming: boolean
  onApply: (p: AtlasProposal) => void
  onCancel: (p: AtlasProposal) => void
}) {
  const { t } = useTranslation()
  switch (block.type) {
    case 'user':
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gray-900 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">
            {block.text}
            {!!block.references?.length && (
              <div className="mt-2 flex flex-wrap gap-1">
                {block.references.map((r) => (
                  <span key={r.uuid} className="rounded-full bg-white/15 px-2 py-0.5 text-xs">
                    {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )
    case 'text':
      return (
        <div className="text-sm text-gray-800 leading-relaxed">
          <AIMarkdownRenderer content={block.text} isStreaming={streaming} tone="light" />
        </div>
      )
    case 'tool':
      return <ToolChip block={block} />
    case 'proposal':
      return <ProposalCard proposal={block} onApply={onApply} onCancel={onCancel} />
    case 'notice': {
      const text =
        block.text === 'stopped' ? t(`${K}stopped`) : block.text === 'no_reply' ? t(`${K}no_reply`) : block.text
      return <div className="text-xs text-gray-400 italic">{text}</div>
    }
    default:
      return null
  }
}

function Links({ links }: { links?: AtlasLink[] | null }) {
  if (!links?.length) return null
  return (
    <span className="inline-flex flex-wrap gap-2">
      {links.map((l) => (
        <a key={l.url} href={l.url} className="text-xs font-medium text-gray-700 underline underline-offset-2 hover:text-gray-900">
          {l.label === 'editor' || l.label === 'url' ? new URL(l.url, 'http://x').pathname.split('/').slice(-2).join('/') : l.label}
        </a>
      ))}
    </span>
  )
}

function ToolChip({ block }: { block: Extract<AtlasBlock, { type: 'tool' }> }) {
  const { t } = useTranslation()
  const label = t(`${K}tool_names.${block.name}`, { defaultValue: humanize(block.name) })
  const icon =
    block.status === 'running' ? (
      <CircleNotch size={14} className="animate-spin text-gray-400" />
    ) : block.status === 'ok' ? (
      <CheckCircle size={14} weight="fill" className="text-emerald-500" />
    ) : block.status === 'awaiting' ? (
      <HourglassMedium size={14} weight="fill" className="text-amber-500" />
    ) : (
      <XCircle size={14} weight="fill" className="text-red-500" />
    )
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
        {icon}
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-400">· {t(`${K}tool_status.${block.status === 'running' ? 'running' : block.status}`)}</span>
      </span>
      {block.error && <span className="text-red-500">{block.error}</span>}
      <Links links={block.links} />
    </div>
  )
}

function ProposalCard({
  proposal,
  onApply,
  onCancel,
}: {
  proposal: AtlasProposal
  onApply: (p: AtlasProposal) => void
  onCancel: (p: AtlasProposal) => void
}) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const applying = proposal.error === '__applying__'
  const destructive = proposal.tier === 'destructive'
  const tierClass = destructive
    ? 'bg-red-50 text-red-700'
    : proposal.tier === 'create'
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-amber-50 text-amber-700'

  return (
    <div className={cn('rounded-xl border bg-white p-4 shadow-sm', destructive ? 'border-red-200' : 'border-gray-200')}>
      <div className="flex items-center gap-2">
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tierClass)}>
          {t(`${K}tier.${['create', 'edit', 'destructive'].includes(proposal.tier) ? proposal.tier : 'edit'}`)}
        </span>
        <span className="text-xs text-gray-500">
          {t(`${K}tool_names.${proposal.tool}`, { defaultValue: humanize(proposal.tool) })}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-900">{proposal.summary}</p>
      {proposal.target?.name && <p className="mt-0.5 text-xs text-gray-500">{proposal.target.name}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {proposal.status === 'pending' && (
          <>
            <span className="me-auto text-xs font-medium text-amber-600">{t(`${K}action.awaiting`)}</span>
            <button
              type="button"
              onClick={() => onCancel(proposal)}
              disabled={applying}
              className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
            >
              {t(`${K}action.cancel`)}
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={() => {
                if (destructive && !confirming) return setConfirming(true)
                onApply(proposal)
              }}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60',
                destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-700'
              )}
            >
              {applying ? t(`${K}action.applying`) : confirming ? `${t(`${K}action.apply`)}?` : t(`${K}action.apply`)}
            </button>
          </>
        )}
        {proposal.status === 'applied' && (
          <>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle size={14} weight="fill" /> {t(`${K}action.applied`)}
            </span>
            <Links links={proposal.links} />
          </>
        )}
        {proposal.status === 'cancelled' && (
          <span className="text-xs text-gray-400">{t(`${K}action.cancelled`)}</span>
        )}
        {proposal.status === 'failed' && (
          <span className="inline-flex items-center gap-1 text-xs text-red-600">
            <XCircle size={14} weight="fill" /> {proposal.error || t(`${K}action.apply_failed`)}
          </span>
        )}
      </div>
    </div>
  )
}
