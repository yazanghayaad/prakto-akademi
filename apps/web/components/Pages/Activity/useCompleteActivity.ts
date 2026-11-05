'use client'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { queryKeys } from '@lib/query/keys'
import { markActivityAsComplete } from '@services/courses/activity'

/*
 * Prakto completion rules:
 *  - Reading items (pages, documents, embeds, ...) count as done as soon as
 *    the learner moves on to the next item.
 *  - A video counts as done once it has played to within 10 seconds of its
 *    end (see Video.tsx); moving on does not complete it.
 *  - Assignments and SCORM packages keep their own completion flow.
 */

const MANUAL_TYPES = new Set(['TYPE_VIDEO', 'TYPE_ASSIGNMENT', 'TYPE_SCORM'])

/** Seconds before the end of a video at which it counts as watched. */
export const VIDEO_COMPLETE_SECONDS_BEFORE_END = 10

/** True when moving past this activity should mark it done. */
export function completesOnNext(activity: any): boolean {
  return !!activity && !MANUAL_TYPES.has(activity.activity_type)
}

/** Look an activity up in the course tree by numeric id or (prefixed or bare) uuid. */
export function findCourseActivity(course: any, idOrUuid: string | number | undefined | null): any {
  if (idOrUuid === undefined || idOrUuid === null || !course?.chapters) return null
  const key = String(idOrUuid).replace('activity_', '')
  for (const chapter of course.chapters) {
    for (const a of chapter.activities ?? []) {
      if (String(a.id) === key || (a.activity_uuid ?? '').replace('activity_', '') === key) return a
    }
  }
  return null
}

/**
 * Returns a function that marks an activity done in the background: the
 * progress shows at once (optimistic trail update), the request runs without
 * blocking navigation, and an activity already done is left alone.
 */
export function useCompleteActivity() {
  const queryClient = useQueryClient()
  const session = useLHSession() as any
  const org = useOrg() as any
  const token = session?.data?.tokens?.access_token

  return useCallback(
    (course: any, activity: any) => {
      if (!token || !org?.id || !course?.course_uuid || !activity?.activity_uuid) return
      const trailKey = queryKeys.trail.org(org.id)
      const courseKey = course.course_uuid.replace('course_', '')
      const sameCourse = (run: any) => run.course?.course_uuid?.replace('course_', '') === courseKey
      const previous: any = queryClient.getQueryData(trailKey)
      const run = previous?.runs?.find(sameCourse)
      if (run?.steps?.some((s: any) => s.activity_id === activity.id && s.complete)) return

      queryClient.setQueryData(trailKey, (trail: any) =>
        trail && {
          ...trail,
          runs: trail.runs?.map((r: any) =>
            sameCourse(r)
              ? { ...r, steps: [...(r.steps || []), { activity_id: activity.id, course_id: r.course_id, complete: true }] }
              : r
          ),
        }
      )
      markActivityAsComplete('', course.course_uuid, activity.activity_uuid, token)
        .then((trail: any) => {
          if (trail?.runs) queryClient.setQueryData(trailKey, trail)
          else queryClient.invalidateQueries({ queryKey: trailKey })
        })
        .catch(() => queryClient.setQueryData(trailKey, previous))
    },
    [token, org?.id, queryClient]
  )
}
