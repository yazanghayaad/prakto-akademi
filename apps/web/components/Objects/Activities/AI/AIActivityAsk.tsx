import { useLHSession } from '@components/Contexts/LHSessionContext'
import {
  sendActivityAIChatMessageStream,
  startActivityAIChatSessionStream,
  StreamCallbacks,
} from '@services/ai/ai'
import {
  AlertTriangle,
  ArrowUp,
  BadgeInfo,
  Lightbulb,
  Maximize2,
  Minimize2,
  NotebookTabs,
  PanelRightOpen,
  PanelTop,
  Sparkle,
  X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import React, { useEffect, useRef } from 'react'
import {
  AIChatBotStateTypes,
  useAIChatBot,
  useAIChatBotDispatch,
} from '@components/Contexts/AI/AIChatBotContext'
import useGetAIFeatures from '../../../Hooks/useGetAIFeatures'
import { useTranslation } from 'react-i18next'
import AIMarkdownRenderer from './AIMarkdownRenderer'
import AIFollowUpSuggestions from './AIFollowUpSuggestions'

// Phones (<768px, the shell's breakpoint) can't spare a 380px column for the
// side panel, so it floats above the bottom bar instead.
const PHONE_QUERY = '(max-width: 767px)'
const subscribePhone = (onChange: () => void) => {
  const mql = window.matchMedia(PHONE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
function useIsPhone() {
  return React.useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  )
}

type AIActivityAskProps = {
  activity: any
}

function AIActivityAsk(props: AIActivityAskProps) {
  const { t } = useTranslation()
  const is_ai_feature_enabled = useGetAIFeatures({ feature: 'activity_ask' })
  const [isButtonAvailable, setIsButtonAvailable] = React.useState(false)
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode } = useAIPanelMode()

  useEffect(() => {
    if (is_ai_feature_enabled) {
      setIsButtonAvailable(true)
    }
  }, [is_ai_feature_enabled])

  const handleOpenAI = () => {
    if (mode === 'hover') {
      dispatchAIChatBot({ type: 'setIsModalOpen' })
    } else {
      dispatchAIChatBot({ type: 'setSidePanelOpen' })
    }
  }

  return (
    <>
      {isButtonAvailable && (
        <div>
          <ActivityChatMessageBox activity={props.activity} />
          <button
            type="button"
            onClick={handleOpenAI}
            className="inline-flex items-center gap-1.5 rounded-md bg-wine-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-wine-800"
          >
            <Sparkle size={14} strokeWidth={2} />
            {t('ai.ask_ai')}
          </button>
        </div>
      )}
    </>
  )
}

export type AIMessage = {
  sender: string
  message: any
  type: 'ai' | 'user'
}

/* --- Shared panel parts ---------------------------------------------------
   Both display modes (the floating bottom panel and the side column) are built
   from these, so the two stay visually identical. */

const SMALL_CAPS = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400'

function PanelIconButton(props: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={props.label}
      aria-label={props.label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
    >
      {props.children}
    </button>
  )
}

function PanelHeader(props: { busy: boolean; children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-wine-900 text-white ${
            props.busy ? 'animate-pulse' : ''
          }`}
        >
          <Sparkle size={15} strokeWidth={2} />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="font-serif text-[17px] font-semibold text-gray-900">
            {t('ai.ask_ai')}
          </p>
          <p className={SMALL_CAPS}>{t('ai.experimental')}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{props.children}</div>
    </div>
  )
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-hidden="true">
      {[0, 0.2, 0.4].map((delay) => (
        <motion.span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-wine-700"
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay }}
        />
      ))}
    </div>
  )
}

type AIMessageComponentProps = {
  message: AIMessage
  isAI: boolean
  isStreaming?: boolean
}

function AIMessageComponent({ message, isAI, isStreaming = false }: AIMessageComponentProps) {
  if (isAI) {
    return (
      <div className="w-full min-w-0">
        <AIMarkdownRenderer content={message.message} isStreaming={isStreaming} tone="light" />
      </div>
    )
  }
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-md bg-gray-100 px-3 py-2 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap">
        {message.message}
      </div>
    </div>
  )
}

const PREDEFINED_QUESTIONS = [
  { label: 'about', key: 'ai.about_question', Icon: BadgeInfo },
  { label: 'flashcards', key: 'ai.flashcards_question', Icon: NotebookTabs },
  { label: 'examples', key: 'ai.examples_question', Icon: Lightbulb },
] as const

function ChatEmptyState(props: { sendMessage: (message: string) => void; wide?: boolean }) {
  const session = useLHSession() as any
  const { t } = useTranslation()
  const username = session?.data?.user?.username
  const help = t('ai.how_can_we_help')

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className={`flex min-h-full flex-col justify-center ${props.wide ? 'mx-auto w-full max-w-3xl' : ''}`}
    >
      <p className="font-serif text-xl font-semibold text-gray-900">
        {t('common.hello')}
        {username ? <span className="capitalize"> {username}</span> : null},
      </p>
      <p className="mt-0.5 text-sm text-gray-500">
        {help.charAt(0).toUpperCase() + help.slice(1)}
      </p>
      <div className={`mt-4 grid gap-1.5 ${props.wide ? 'sm:grid-cols-3' : 'grid-cols-1'}`}>
        {PREDEFINED_QUESTIONS.map(({ label, key, Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => props.sendMessage(t(key))}
            className="group flex items-start gap-2.5 rounded-md border border-gray-200 bg-white px-3 py-2 text-start text-[13px] leading-snug text-gray-700 transition-colors hover:border-wine-300 hover:bg-wine-50 hover:text-wine-900"
          >
            <Icon size={15} className="mt-px shrink-0 text-gray-400 transition-colors group-hover:text-wine-700" />
            <span>{t(key)}</span>
          </button>
        ))}
      </div>
    </motion.div>
  )
}

function ChatError(props: { message: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-full items-center justify-center">
      <div className="flex w-full max-w-[600px] gap-2.5 rounded-md border border-red-200 bg-red-50 p-3">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-700" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-red-900">
            {t('common.something_wrong_happened')}
          </h3>
          <p className="text-sm text-red-800 break-words">{props.message}</p>
        </div>
      </div>
    </div>
  )
}

/** The scrollable middle of the panel: conversation, empty state or error. */
function ChatThread(props: {
  state: AIChatBotStateTypes
  sendMessage: (message: string) => void
  isInputDisabled: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  keyPrefix: string
  wide?: boolean
}) {
  const { state } = props

  let body: React.ReactNode
  if (state.error.isError) {
    body = <ChatError message={state.error.error_message} />
  } else if (state.messages.length === 0) {
    body = <ChatEmptyState sendMessage={props.sendMessage} wide={props.wide} />
  } else {
    body = (
      <div className={`flex flex-col space-y-5 ${props.wide ? 'mx-auto w-full max-w-3xl' : ''}`}>
        <AnimatePresence mode="popLayout">
          {state.messages.map((message: AIMessage, index: number) => (
            <motion.div
              key={`${props.keyPrefix}-${index}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <AIMessageComponent message={message} isAI={message.sender === 'ai'} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Waiting for the first chunk */}
        <AnimatePresence>
          {state.isStreaming && !state.streamingContent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <ThinkingDots />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Streaming answer */}
        <AnimatePresence>
          {state.isStreaming && state.streamingContent && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <AIMessageComponent
                message={{ sender: 'ai', message: state.streamingContent, type: 'ai' }}
                isAI={true}
                isStreaming={true}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Follow-up suggestions, or the indicator while they load */}
        <AnimatePresence>
          {!state.isStreaming && (
            <>
              {state.isLoadingFollowUps && state.followUpSuggestions.length === 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-1.5 py-1"
                >
                  {[0, 0.15, 0.3].map((delay) => (
                    <motion.span
                      key={delay}
                      className="h-1 w-1 rounded-full bg-gray-400"
                      animate={{ opacity: [0.3, 0.9, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut', delay }}
                    />
                  ))}
                </motion.div>
              )}
              {state.followUpSuggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                >
                  <AIFollowUpSuggestions
                    suggestions={state.followUpSuggestions}
                    onSuggestionClick={props.sendMessage}
                    disabled={props.isInputDisabled}
                  />
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div
      ref={props.containerRef}
      className="min-h-0 flex-auto overflow-y-auto scroll-smooth px-4 py-4"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--color-gray-300) transparent' }}
    >
      {body}
    </div>
  )
}

function ChatComposer(props: {
  value: string
  disabled: boolean
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onSend: () => void
  wide?: boolean
}) {
  const { t } = useTranslation()
  const canSend = !props.disabled && !!props.value?.trim()
  return (
    <div className="shrink-0 border-t border-gray-200 bg-gray-50/60 p-3">
      <div
        className={`flex items-center gap-2 rounded-md border border-gray-300 bg-white py-1.5 pe-1.5 ps-3 transition-colors focus-within:border-wine-700 focus-within:ring-2 focus-within:ring-wine-100 ${
          props.wide ? 'mx-auto w-full max-w-3xl' : ''
        } ${props.disabled ? 'opacity-60' : ''}`}
      >
        <input
          onKeyDown={props.onKeyDown}
          onChange={props.onChange}
          disabled={props.disabled}
          value={props.value}
          aria-label={t('ai.ask_ai_placeholder')}
          placeholder={t('ai.ask_ai_placeholder')}
          type="text"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm text-gray-900 outline-hidden placeholder:text-gray-400 disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={() => canSend && props.onSend()}
          disabled={!canSend}
          title={t('common.submit')}
          aria-label={t('common.submit')}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded bg-wine-900 text-white transition-colors hover:bg-wine-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
        >
          <ArrowUp size={15} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  )
}

type ActivityChatMessageBoxProps = {
  activity: any
}

function ActivityChatMessageBox(props: ActivityChatMessageBoxProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token;
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode, setMode } = useAIPanelMode()

  const isInputDisabled = aiChatBotState.isWaitingForResponse || aiChatBotState.isStreaming

  useEffect(() => {
    if (aiChatBotState.isModalOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
  }, [aiChatBotState.isModalOpen])

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      // Perform the sending action here
      sendMessage(event.currentTarget.value)
    }
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIChatBot({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  // Ref to track accumulated content during streaming (avoids closure issues)
  const accumulatedContentRef = useRef('')

  const sendMessage = async (message: string) => {
    if (!message.trim()) return

    // Clear previous follow-up suggestions and reset accumulated content
    await dispatchAIChatBot({ type: 'clearFollowUpSuggestions' })
    accumulatedContentRef.current = ''

    // Add user message
    await dispatchAIChatBot({
      type: 'addMessage',
      payload: { sender: 'user', message: message, type: 'user' },
    })

    // Set loading states
    await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
    await dispatchAIChatBot({ type: 'setIsStreaming' })
    await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })

    // Streaming callbacks
    const callbacks: StreamCallbacks = {
      onStart: (data) => {
        // Set the chat UUID immediately when we get the start event
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }
      },
      onChunk: (chunk) => {
        accumulatedContentRef.current += chunk
        dispatchAIChatBot({ type: 'appendStreamingContent', payload: chunk })
      },
      onComplete: (data) => {
        // Add the complete AI message to the messages array
        const finalContent = accumulatedContentRef.current
        dispatchAIChatBot({
          type: 'addMessage',
          payload: { sender: 'ai', message: finalContent, type: 'ai' },
        })

        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })

        // Set the chat UUID if not already set
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }

        // Start loading follow-ups indicator
        dispatchAIChatBot({ type: 'setIsLoadingFollowUps' })

        // Reset accumulated content
        accumulatedContentRef.current = ''
      },
      onFollowUps: (data) => {
        // Set follow-up suggestions when they arrive
        if (data.follow_up_suggestions && data.follow_up_suggestions.length > 0) {
          dispatchAIChatBot({
            type: 'setFollowUpSuggestions',
            payload: data.follow_up_suggestions,
          })
        } else {
          dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        }
      },
      onError: (error) => {
        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        accumulatedContentRef.current = ''
        dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: 500,
            error_message: error,
          },
        })
      },
    }

    // Call appropriate streaming function
    if (aiChatBotState.aichat_uuid) {
      await sendActivityAIChatMessageStream(
        message,
        aiChatBotState.aichat_uuid,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    } else {
      await startActivityAIChatSessionStream(
        message,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    }
  }

  function closeModal() {
    dispatchAIChatBot({ type: 'setIsModalClose' })
    dispatchAIChatBot({ type: 'setFullscreen', payload: false })
  }

  function toggleFullscreen() {
    dispatchAIChatBot({ type: 'toggleFullscreen' })
  }

  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // Smooth scroll to bottom with easing
  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const targetScroll = container.scrollHeight - container.clientHeight
      const currentScroll = container.scrollTop
      const distance = targetScroll - currentScroll

      if (Math.abs(distance) < 1) return

      // Smooth scroll with easing
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      })
    }
  }

  useEffect(() => {
    // Small delay to ensure content is rendered
    const timer = setTimeout(scrollToBottom, 50)
    return () => clearTimeout(timer)
  }, [aiChatBotState.messages, aiChatBotState.streamingContent])

  return (
    <AnimatePresence>
      {aiChatBotState.isModalOpen && (
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed top-0 start-0 w-full h-full z-[9999] flex justify-center items-center"
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{ pointerEvents: 'auto' }}
            className={`fixed bottom-4 left-1/2 z-[10000] mx-auto flex w-10/12 max-w-(--breakpoint-2xl) -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-900 shadow-[0_18px_50px_-20px_rgba(28,25,23,0.35)] transition-[height] duration-300 max-md:bottom-[calc(var(--lh-mobile-nav-h)+8px)] max-md:w-[calc(100%-16px)] ${
              aiChatBotState.isFullscreen ? 'h-[80vh]' : 'h-[350px]'
            }`}
          >
            <PanelHeader busy={isInputDisabled}>
              <PanelIconButton
                onClick={() => {
                  setMode('side')
                  dispatchAIChatBot({ type: 'switchToSideMode' })
                }}
                label={t('ai.switch_to_side_mode')}
              >
                <PanelRightOpen size={17} />
              </PanelIconButton>
              <PanelIconButton
                onClick={toggleFullscreen}
                label={aiChatBotState.isFullscreen ? t('ai.exit_fullscreen') : t('ai.fullscreen')}
              >
                {aiChatBotState.isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </PanelIconButton>
              <PanelIconButton onClick={closeModal} label={t('common.close')}>
                <X size={18} />
              </PanelIconButton>
            </PanelHeader>

            <ChatThread
              state={aiChatBotState}
              sendMessage={sendMessage}
              isInputDisabled={isInputDisabled}
              containerRef={messagesContainerRef}
              keyPrefix="msg"
              wide
            />

            <ChatComposer
              value={aiChatBotState.chatInputValue}
              disabled={isInputDisabled}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onSend={() => sendMessage(aiChatBotState.chatInputValue)}
              wide
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type AISidePanelProps = {
  activity: any
}

// Inline sticky side panel that sits next to content
function AISidePanelInline(props: AISidePanelProps) {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const { mode, setMode } = useAIPanelMode()
  const isInitialRender = useRef(true)
  const accumulatedContentRef = useRef('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [isSecondaryBarVisible, setIsSecondaryBarVisible] = React.useState(false)
  const isPhone = useIsPhone()

  const isInputDisabled = aiChatBotState?.isWaitingForResponse || aiChatBotState?.isStreaming

  // Mark initial render complete after mount
  useEffect(() => {
    const timer = setTimeout(() => {
      isInitialRender.current = false
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // Track when the secondary bar becomes visible (when activity-info-section scrolls out of view)
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsSecondaryBarVisible(!entry.isIntersecting)
      },
      {
        threshold: [0, 0.1, 1],
        rootMargin: '-80px 0px 0px 0px'
      }
    )

    const mainActivityInfo = document.querySelector('.activity-info-section')
    if (mainActivityInfo) {
      observer.observe(mainActivityInfo)
    }

    return () => {
      if (mainActivityInfo) {
        observer.unobserve(mainActivityInfo)
      }
    }
  }, [])

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      const container = messagesContainerRef.current
      const targetScroll = container.scrollHeight - container.clientHeight
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      })
    }
  }

  useEffect(() => {
    const timer = setTimeout(scrollToBottom, 50)
    return () => clearTimeout(timer)
  }, [aiChatBotState?.messages, aiChatBotState?.streamingContent])

  // Don't render if side panel is not open
  if (!aiChatBotState?.isSidePanelOpen) {
    return null
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      sendMessage(event.currentTarget.value)
    }
  }

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await dispatchAIChatBot({
      type: 'setChatInputValue',
      payload: event.currentTarget.value,
    })
  }

  const sendMessage = async (message: string) => {
    if (!message.trim()) return

    await dispatchAIChatBot({ type: 'clearFollowUpSuggestions' })
    accumulatedContentRef.current = ''

    await dispatchAIChatBot({
      type: 'addMessage',
      payload: { sender: 'user', message: message, type: 'user' },
    })

    await dispatchAIChatBot({ type: 'setIsWaitingForResponse' })
    await dispatchAIChatBot({ type: 'setIsStreaming' })
    await dispatchAIChatBot({ type: 'setChatInputValue', payload: '' })

    const callbacks: StreamCallbacks = {
      onStart: (data) => {
        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }
      },
      onChunk: (chunk) => {
        accumulatedContentRef.current += chunk
        dispatchAIChatBot({ type: 'appendStreamingContent', payload: chunk })
      },
      onComplete: (data) => {
        const finalContent = accumulatedContentRef.current
        dispatchAIChatBot({
          type: 'addMessage',
          payload: { sender: 'ai', message: finalContent, type: 'ai' },
        })

        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })

        if (data.aichat_uuid) {
          dispatchAIChatBot({ type: 'setAichat_uuid', payload: data.aichat_uuid })
        }

        dispatchAIChatBot({ type: 'setIsLoadingFollowUps' })
        accumulatedContentRef.current = ''
      },
      onFollowUps: (data) => {
        if (data.follow_up_suggestions && data.follow_up_suggestions.length > 0) {
          dispatchAIChatBot({
            type: 'setFollowUpSuggestions',
            payload: data.follow_up_suggestions,
          })
        } else {
          dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        }
      },
      onError: (error) => {
        dispatchAIChatBot({ type: 'setStreamingComplete' })
        dispatchAIChatBot({ type: 'setIsNoLongerWaitingForResponse' })
        dispatchAIChatBot({ type: 'clearStreamingContent' })
        dispatchAIChatBot({ type: 'setIsNotLoadingFollowUps' })
        accumulatedContentRef.current = ''
        dispatchAIChatBot({
          type: 'setError',
          payload: {
            isError: true,
            status: 500,
            error_message: error,
          },
        })
      },
    }

    if (aiChatBotState.aichat_uuid) {
      await sendActivityAIChatMessageStream(
        message,
        aiChatBotState.aichat_uuid,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    } else {
      await startActivityAIChatSessionStream(
        message,
        props.activity.activity_uuid,
        access_token,
        callbacks
      )
    }
  }

  function closeSidePanel() {
    dispatchAIChatBot({ type: 'setSidePanelClose' })
  }

  // Adjust top position based on secondary bar visibility
  const topPosition = isSecondaryBarVisible ? '144px' : '80px'
  // The panel is as tall as its content and only grows to this cap, so an
  // empty chat is a compact card instead of a full-height column. The 720px
  // ceiling keeps the input on screen before the panel has stuck to the top.
  const panelMaxHeight = isSecondaryBarVisible
    ? 'min(calc(100vh - 220px), 720px)'
    : 'min(calc(100vh - 160px), 720px)'

  return (
    <motion.div
      initial={isInitialRender.current ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={isInitialRender.current ? { duration: 0 } : { duration: 0.22, ease: 'easeOut' }}
      style={
        isPhone
          ? { maxHeight: 'min(70dvh, 560px)' }
          : { maxHeight: panelMaxHeight, top: topPosition }
      }
      className={`${
        isPhone
          ? 'fixed inset-x-2 bottom-[calc(var(--lh-mobile-nav-h)+8px)] z-[9998] shadow-[0_18px_50px_-20px_rgba(28,25,23,0.35)]'
          : 'sticky w-[380px] shrink-0 self-start'
      } flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-gray-900 transition-[top] duration-300`}
    >
      <PanelHeader busy={isInputDisabled}>
        <PanelIconButton
          onClick={() => {
            setMode('hover')
            dispatchAIChatBot({ type: 'switchToHoverMode' })
          }}
          label={t('ai.switch_to_hover_mode')}
        >
          <PanelTop size={17} />
        </PanelIconButton>
        <PanelIconButton onClick={closeSidePanel} label={t('common.close')}>
          <X size={18} />
        </PanelIconButton>
      </PanelHeader>

      <ChatThread
        state={aiChatBotState}
        sendMessage={sendMessage}
        isInputDisabled={isInputDisabled}
        containerRef={messagesContainerRef}
        keyPrefix="side-msg"
      />

      <ChatComposer
        value={aiChatBotState.chatInputValue}
        disabled={isInputDisabled}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSend={() => sendMessage(aiChatBotState.chatInputValue)}
      />
    </motion.div>
  )
}

// Type for AI panel display mode
export type AIPanelMode = 'side' | 'hover'

// Context for AI panel mode
const AIPanelModeContext = React.createContext<{
  mode: AIPanelMode
  setMode: (mode: AIPanelMode) => void
}>({
  mode: 'side',
  setMode: () => {},
})

export function useAIPanelMode() {
  return React.useContext(AIPanelModeContext)
}

// Hook to manage side panel localStorage persistence
export function useAISidePanelPersistence() {
  const aiChatBotState = useAIChatBot() as AIChatBotStateTypes
  const dispatchAIChatBot = useAIChatBotDispatch() as any
  const isInitialMount = useRef(true)
  const [mode, setModeState] = React.useState<AIPanelMode>('side')

  // Restore state from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && isInitialMount.current) {
      // Restore mode preference first
      const savedMode = localStorage.getItem('aiPanelMode') as AIPanelMode
      const restoredMode = (savedMode === 'side' || savedMode === 'hover') ? savedMode : 'side'
      setModeState(restoredMode)

      // Only restore panel open state if mode is 'side'
      if (restoredMode === 'side') {
        const savedState = localStorage.getItem('aiSidePanelOpen')
        if (savedState === 'true') {
          dispatchAIChatBot({ type: 'setSidePanelOpen' })
        }
      }
      isInitialMount.current = false
    }
  }, [dispatchAIChatBot])

  // Save side panel state to localStorage when it changes (only in side mode)
  useEffect(() => {
    if (typeof window !== 'undefined' && !isInitialMount.current && mode === 'side') {
      localStorage.setItem('aiSidePanelOpen', aiChatBotState?.isSidePanelOpen?.toString() || 'false')
    }
  }, [aiChatBotState?.isSidePanelOpen, mode])

  const setMode = (newMode: AIPanelMode) => {
    setModeState(newMode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('aiPanelMode', newMode)
    }
  }

  return { mode, setMode }
}

// Wrapper component - provides mode context and handles persistence
export function AISidePanelContentWrapper({ children }: { children: React.ReactNode }) {
  const { mode, setMode } = useAISidePanelPersistence()
  return (
    <AIPanelModeContext.Provider value={{ mode, setMode }}>
      {children}
    </AIPanelModeContext.Provider>
  )
}

// Export the inline panel for use in activity.tsx
export { AISidePanelInline }

export default AIActivityAsk
