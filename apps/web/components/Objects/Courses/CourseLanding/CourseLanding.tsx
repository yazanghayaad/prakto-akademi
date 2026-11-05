'use client'
import React, { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Clock, Layers, Route, Sparkles } from 'lucide-react'
import { getUriWithOrg } from '@services/config/config'
import { getPath, removePathPrefix } from '@services/paths/paths'
import { usePathsForCourse } from '@/hooks/queries/usePaths'
import { useCourses } from '@/hooks/queries/useCourses'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import CourseThumbnail from '@components/Objects/Thumbnails/CourseThumbnail'

/*
 * Pieces of the course page laid out the way a university course page is:
 * a title block with the programme it belongs to, a row of key facts, the
 * modules with their study time, who offers it, and the other courses in the
 * same programme. Everything shown comes from the course itself, its learning
 * path, and the outline metadata on its chapters; nothing is made up.
 */

// ---------------------------------------------------------------- helpers

/** Minutes of study in a chapter, from its outline metadata (if any). */
export function chapterMinutes(chapter: any): number {
  const minutes = chapter?.extra_metadata?.prakto_outline?.minutes
  if (!minutes) return 0
  return Object.values(minutes).reduce((n: number, m: any) => n + (Number(m) || 0), 0)
}

/** "45 min" / "1 timme" / "3 timmar", rounded the way people talk about it. */
export function useDurationLabel() {
  const { t } = useTranslation()
  return (minutes: number) => {
    if (!minutes) return ''
    if (minutes < 55) return t('courses.duration_minutes', { count: Math.max(5, Math.round(minutes / 5) * 5) })
    return t('courses.duration_hours', { count: Math.max(1, Math.round(minutes / 60)) })
  }
}

/** The learning path this course sits in, with its place and siblings. */
export function useCourseProgramme(courseUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const org = useOrg() as any
  const enabled = org?.config?.config?.resolved_features?.paths?.enabled === true
  const { data: paths } = usePathsForCourse(courseUuid, enabled)
  const first = paths?.[0]
  const { data: detail } = useQuery({
    queryKey: ['prakto-course-programme', first?.path_uuid],
    queryFn: () => getPath(first!.path_uuid, accessToken),
    enabled: !!first?.path_uuid,
    staleTime: 60_000,
  })
  return useMemo(() => {
    if (!detail?.courses?.length) return null
    const ordered = [...detail.courses].sort((a: any, b: any) => a.position - b.position)
    const index = ordered.findIndex((c: any) => c.course_uuid === courseUuid)
    return {
      pathUuid: detail.path_uuid,
      name: detail.name,
      position: index >= 0 ? index + 1 : null,
      total: ordered.length,
      courseUuids: ordered.map((c: any) => c.course_uuid),
    }
  }, [detail, courseUuid])
}

// ---------------------------------------------------------------- hero

export function CourseHeroText({ course, orgslug, programme }: { course: any; orgslug: string; programme: any }) {
  const { t } = useTranslation()
  const authors = (course?.authors ?? []).filter((a: any) => a.authorship_status === 'ACTIVE')
  const names = authors
    .slice(0, 2)
    .map((a: any) =>
      a.user.first_name || a.user.last_name ? `${a.user.first_name} ${a.user.last_name}`.trim() : `@${a.user.username}`
    )
  const summary = (course?.about || '').trim()
  return (
    <div className="min-w-0">
      {programme ? (
        <Link
          href={getUriWithOrg(orgslug, `/path/${removePathPrefix(programme.pathUuid)}`)}
          className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-wine-800 hover:text-wine-950"
        >
          <span>{programme.name}</span>
          {programme.position && (
            <span className="text-gray-400 font-medium">
              · {t('courses.course_n_of', { n: programme.position, total: programme.total })}
            </span>
          )}
        </Link>
      ) : course?.description ? (
        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-wine-800">{course.description}</div>
      ) : null}
      <h1
        className="mt-3 font-serif text-[40px] leading-[1.1] font-semibold text-gray-950 max-sm:text-[28px] text-balance"
        dir="auto"
      >
        {course?.name}
      </h1>
      {summary && (
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-gray-600 line-clamp-4 whitespace-pre-line">{summary}</p>
      )}
      {names.length > 0 && (
        <p className="mt-5 text-sm text-gray-600">
          {t('courses.instructor')}: <span className="font-semibold text-gray-900">{names.join(', ')}</span>
          {authors.length > 2 && <span className="text-gray-500"> +{authors.length - 2}</span>}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- key facts

export function CourseStatsBar({ course, programme, orgslug }: { course: any; programme: any; orgslug: string }) {
  const { t } = useTranslation()
  const duration = useDurationLabel()
  const chapters: any[] = course?.chapters ?? []
  const activities = chapters.reduce((n, ch) => n + (ch.activities?.length ?? 0), 0)
  const minutes = chapters.reduce((n, ch) => n + chapterMinutes(ch), 0)

  const cells = [
    {
      icon: <Layers size={18} />,
      title: t('courses.n_modules', { count: chapters.length }),
      sub: t('courses.n_activities', { count: activities }),
    },
    minutes > 0 && {
      icon: <Clock size={18} />,
      title: duration(minutes),
      sub: t('courses.to_complete'),
    },
    {
      icon: <Sparkles size={18} />,
      title: t('courses.self_paced'),
      sub: t('courses.self_paced_desc'),
    },
    programme && {
      icon: <Route size={18} />,
      title: programme.name,
      sub: t('courses.part_of_path'),
      href: getUriWithOrg(orgslug, `/path/${removePathPrefix(programme.pathUuid)}`),
    },
  ].filter(Boolean) as any[]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 bg-white nice-shadow rounded-lg divide-x divide-gray-100 rtl:divide-x-reverse max-lg:divide-y">
      {cells.map((c, i) => {
        const inner = (
          <div className="flex items-start gap-3 px-5 py-4 h-full">
            <span className="mt-0.5 text-wine-800 shrink-0">{c.icon}</span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold leading-snug text-gray-900">{c.title}</span>
              <span className="block text-[13px] text-gray-500">{c.sub}</span>
            </span>
          </div>
        )
        return c.href ? (
          <Link key={i} href={c.href} className="hover:bg-gray-50 transition-colors">
            {inner}
          </Link>
        ) : (
          <div key={i}>{inner}</div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- sidebar

export function OfferedByCard() {
  const { t } = useTranslation()
  const org = useOrg() as any
  return (
    <div className="bg-white nice-shadow rounded-lg p-5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-gray-500 font-semibold">{t('courses.offered_by')}</div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-11 w-11 rounded-md border border-gray-200 bg-white p-1.5 shrink-0">
          <img src="/lrn-dash.svg?v=prakto-1" alt="" className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-gray-900">{org?.name}</div>
          {org?.description && <div className="text-xs text-gray-500 line-clamp-2">{org.description}</div>}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- more in programme

export function ProgrammeCourses({ programme, currentCourseUuid, orgslug }: { programme: any; currentCourseUuid: string; orgslug: string }) {
  const { t } = useTranslation()
  const { data: courses } = useCourses(orgslug)
  if (!programme) return null
  const byUuid = new Map<string, any>((courses ?? []).map((c: any) => [c.course_uuid, c]))
  const items = programme.courseUuids
    .map((uuid: string, i: number) => ({ course: byUuid.get(uuid), n: i + 1 }))
    .filter((x: any) => x.course && x.course.course_uuid !== currentCourseUuid)
  if (items.length === 0) return null
  return (
    <section className="mt-14">
      <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-gray-200 pb-2">
        <h2 className="text-[22px] font-semibold text-gray-900">{t('courses.more_in_programme', { name: programme.name })}</h2>
        <Link
          href={getUriWithOrg(orgslug, `/path/${removePathPrefix(programme.pathUuid)}`)}
          className="shrink-0 text-sm font-semibold text-wine-800 hover:text-wine-950"
        >
          {t('courses.view_path')} <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.slice(0, 8).map(({ course, n }: any) => (
          <CourseThumbnail
            key={course.course_uuid}
            course={course}
            orgslug={orgslug}
            coverEyebrow={t('courses.course_n_of', { n, total: programme.total })}
          />
        ))}
      </div>
    </section>
  )
}
