'use client'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Lock } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { cn } from '@/lib/utils'

/**
 * Course outline beside a lesson, in the manner of a university course page:
 * the course title, overall progress, then each module with its lessons as
 * small headings and every item with its type and length. The open module is
 * the one being studied; the current item is marked and scrolled into view.
 *
 * Lesson headings and lengths come from chapter.extra_metadata.prakto_outline
 * ({ lessons: [{ title, start }], minutes: { [activity_uuid]: n } }), written
 * when imported lessons were folded into one chapter per module. Chapters
 * without it simply list their items.
 */

interface Props {
  course: any
  currentActivityId: string
  orgslug: string
  trailData?: any
  className?: string
}

const strip = (uuid: string) => (uuid || '').replace('activity_', '')

export default function CourseOutlineSidebar({ course, currentActivityId, orgslug, trailData, className }: Props) {
  const { t } = useTranslation()
  const courseId = (course?.course_uuid || '').replace('course_', '')
  const chapters: any[] = useMemo(() => course?.chapters ?? [], [course])

  const doneIds = useMemo(() => {
    const run = trailData?.runs?.find(
      (r: any) => r.course?.course_uuid?.replace('course_', '') === courseId
    )
    return new Set<number>((run?.steps ?? []).filter((s: any) => s.complete).map((s: any) => s.activity_id))
  }, [trailData, courseId])

  const currentChapterIdx = useMemo(
    () => chapters.findIndex((ch) => ch.activities?.some((a: any) => strip(a.activity_uuid) === currentActivityId)),
    [chapters, currentActivityId]
  )

  const [open, setOpen] = useState<Record<number, boolean>>(() =>
    currentChapterIdx >= 0 ? { [currentChapterIdx]: true } : {}
  )
  useEffect(() => {
    if (currentChapterIdx >= 0) setOpen((prev) => ({ ...prev, [currentChapterIdx]: true }))
  }, [currentChapterIdx])

  // Bring the current item into view inside the outline only; scrollIntoView
  // would scroll the page as well.
  const navRef = useRef<HTMLElement | null>(null)
  const currentRef = useRef<HTMLAnchorElement | null>(null)
  useEffect(() => {
    const nav = navRef.current
    const item = currentRef.current
    if (!nav || !item) return
    const navBox = nav.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    // Leave the list alone when the item is already in view.
    if (itemBox.top >= navBox.top && itemBox.bottom <= navBox.bottom) return
    nav.scrollTop += itemBox.top - navBox.top - nav.clientHeight / 2 + itemBox.height / 2
    // Only on arrival at a lesson, not every time a module is toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentActivityId])

  const total = chapters.reduce((n, ch) => n + (ch.activities?.length ?? 0), 0)
  const done = chapters.reduce(
    (n, ch) => n + (ch.activities ?? []).filter((a: any) => doneIds.has(a.id)).length,
    0
  )
  const percent = total ? Math.round((done / total) * 100) : 0

  const typeLabel = (a: any) => {
    if (a.activity_sub_type === 'SUBTYPE_DYNAMIC_MARKDOWN') return t('activities.markdown')
    if (a.activity_sub_type === 'SUBTYPE_DYNAMIC_EMBED') return t('activities.embed')
    switch (a.activity_type) {
      case 'TYPE_VIDEO': return t('activities.video')
      case 'TYPE_DOCUMENT': return t('activities.document')
      case 'TYPE_DYNAMIC': return t('activities.page')
      case 'TYPE_ASSIGNMENT': return t('activities.assignment')
      case 'TYPE_SCORM': return t('activities.scorm')
      case 'TYPE_LIVE_SESSION': return t('activities.live_session')
      default: return t('activities.learning_material')
    }
  }

  return (
    <aside
      aria-label={t('courses.course_content')}
      className={cn(
        'w-75 shrink-0 sticky top-21 max-h-[calc(100vh-108px)] flex flex-col bg-white nice-shadow rounded-lg overflow-hidden',
        className
      )}
    >
      <div className="px-5 pt-4 pb-4 border-b border-gray-200">
        <Link
          href={getUriWithOrg(orgslug, `/course/${courseId}`)}
          className="block font-serif text-[17px] font-semibold leading-snug text-gray-900 hover:text-wine-900"
        >
          {course?.name}
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 flex-1 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-wine-800 rounded-full" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-xs text-gray-500 tabular-nums shrink-0">{done}/{total}</span>
        </div>
      </div>

      <nav ref={navRef} className="flex-1 overflow-y-auto overscroll-contain pb-3">
        {chapters.map((ch, idx) => {
          const outline = ch.extra_metadata?.prakto_outline
          const lessonAt = new Map<string, string>(
            (outline?.lessons ?? []).map((l: any) => [l.start, l.title])
          )
          const minutes: Record<string, number> = outline?.minutes ?? {}
          const isOpen = !!open[idx]
          const chDone = (ch.activities ?? []).filter((a: any) => doneIds.has(a.id)).length
          return (
            <section key={ch.chapter_uuid || ch.id} className={idx > 0 ? 'border-t border-gray-100' : ''}>
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [idx]: !isOpen }))}
                aria-expanded={isOpen}
                className="w-full text-start px-5 pt-4 pb-3 flex items-start gap-3 hover:bg-gray-50/70 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-wine-800">
                    {t('courses.module_n', { n: idx + 1 })}
                    {chDone > 0 && (
                      <span className="ms-2 normal-case tracking-normal font-normal text-gray-400">
                        {chDone}/{ch.activities?.length ?? 0}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[15px] font-semibold leading-snug text-gray-900">{ch.name}</div>
                </div>
                <ChevronDown
                  size={16}
                  className={cn('mt-1 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-180')}
                />
              </button>

              {isOpen && (
                <ul className="pb-2">
                  {(ch.activities ?? []).map((a: any) => {
                    const id = strip(a.activity_uuid)
                    const isCurrent = id === currentActivityId
                    const isDone = doneIds.has(a.id)
                    const heading = lessonAt.get(a.activity_uuid)
                    const mins = minutes[a.activity_uuid]
                    return (
                      <React.Fragment key={a.activity_uuid}>
                        {heading && (
                          <li className="px-5 pt-3 pb-1 text-[13px] font-semibold leading-snug text-gray-600">
                            {heading}
                          </li>
                        )}
                        <li>
                          <Link
                            ref={isCurrent ? currentRef : undefined}
                            href={getUriWithOrg(orgslug, '') + `/course/${courseId}/activity/${id}`}
                            prefetch={false}
                            aria-current={isCurrent ? 'page' : undefined}
                            className={cn(
                              'mx-2 flex items-start gap-3 rounded-md px-3 py-2 transition-colors',
                              isCurrent ? 'bg-wine-50' : 'hover:bg-gray-50'
                            )}
                          >
                            <span
                              className={cn(
                                'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border',
                                isDone
                                  ? 'border-forest-700 bg-forest-700 text-white'
                                  : isCurrent
                                    ? 'border-wine-800 bg-white'
                                    : 'border-gray-300 bg-white'
                              )}
                            >
                              {isDone ? (
                                <Check size={11} strokeWidth={3} />
                              ) : a.is_locked ? (
                                <Lock size={9} className="text-gray-400" />
                              ) : isCurrent ? (
                                <span className="h-2 w-2 rounded-full bg-wine-800" />
                              ) : null}
                            </span>
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  'block text-[14px] leading-snug',
                                  isCurrent ? 'font-semibold text-gray-950' : 'text-gray-800'
                                )}
                              >
                                {a.name}
                              </span>
                              <span className="block text-xs text-gray-500 mt-0.5">
                                {typeLabel(a)}
                                {mins ? ` • ${t('courses.minutes_short', { count: mins })}` : ''}
                              </span>
                            </span>
                          </Link>
                        </li>
                      </React.Fragment>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}
      </nav>
    </aside>
  )
}
