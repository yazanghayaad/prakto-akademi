'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  chapterIndexAt,
  formatClock,
  spriteFrameAt,
  type HlsThumbnails,
  type VideoChapter,
} from './videoSource'

interface VideoChaptersProps {
  chapters: VideoChapter[]
  video: HTMLVideoElement | null
  /** Storyboard sprite, for a preview frame per chapter. */
  thumbnails?: HlsThumbnails | null
  heading: string
}

/**
 * Chapter strip under the player, on the dark theater band: one card per
 * chapter with a storyboard frame, its start time and title. The playing
 * chapter is highlighted with its progress; clicking a card seeks there.
 */
export default function VideoChapters({ chapters, video, thumbnails, heading }: VideoChaptersProps) {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!video) return
    const sync = () => {
      setTime(video.currentTime || 0)
      if (Number.isFinite(video.duration)) setDuration(video.duration)
    }
    sync()
    video.addEventListener('timeupdate', sync)
    video.addEventListener('seeked', sync)
    video.addEventListener('loadedmetadata', sync)
    return () => {
      video.removeEventListener('timeupdate', sync)
      video.removeEventListener('seeked', sync)
      video.removeEventListener('loadedmetadata', sync)
    }
  }, [video])

  const active = chapterIndexAt(chapters, time)

  // Keep the playing chapter in view by scrolling the strip only, never the page.
  useEffect(() => {
    const strip = stripRef.current
    const card = strip?.children[active] as HTMLElement | undefined
    if (!strip || !card) return
    const left = card.offsetLeft - strip.offsetLeft
    if (left < strip.scrollLeft || left + card.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' })
    }
  }, [active])

  const seek = (start: number) => {
    if (!video) return
    video.currentTime = start
    void video.play().catch(() => {
      /* autoplay policy; the seek still lands */
    })
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {heading} · {chapters.length}
      </h2>
      <div ref={stripRef} className="flex snap-x gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
        {chapters.map((c, i) => {
          const end = i + 1 < chapters.length ? chapters[i + 1].start : duration || c.start
          const isActive = i === active
          const progress = isActive && end > c.start ? Math.min(1, (time - c.start) / (end - c.start)) : 0
          return (
            <button
              key={`${c.start}-${i}`}
              type="button"
              onClick={() => seek(c.start)}
              aria-current={isActive ? 'true' : undefined}
              className="group flex min-w-52 flex-1 basis-0 snap-start items-center gap-3 text-start"
            >
              <span
                className={`relative block aspect-video w-20 shrink-0 overflow-hidden rounded-md bg-gray-100 bg-no-repeat ring-1 transition ${
                  isActive ? 'ring-wine-700' : 'opacity-80 ring-gray-200 group-hover:opacity-100'
                }`}
                style={thumbnails ? spriteFrameAt(thumbnails, c.start + 2) : undefined}
              >
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/40">
                    <span className="block h-full bg-white" style={{ width: `${progress * 100}%` }} />
                  </span>
                )}
              </span>
              <span className="min-w-0 text-[13px] leading-snug">
                <span className="block text-[11px] tabular-nums text-gray-500">{formatClock(c.start)}</span>
                <span
                  className={`line-clamp-2 transition-colors ${
                    isActive ? 'text-gray-950 font-semibold' : 'text-gray-600 group-hover:text-gray-900'
                  }`}
                >
                  {c.title}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
