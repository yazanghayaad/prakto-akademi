import React from 'react'
import { cn } from '@/lib/utils'

/**
 * Typographic cover for a course (or path) that has no thumbnail image.
 *
 * Imported courses arrive without artwork, and a wall of identical grey
 * placeholders made every listing look unfinished. Instead each course gets a
 * book-jacket style cover in one of the house colours, picked from its name so
 * the same course always looks the same, with the title set in the serif.
 *
 * Sizing is done with container query units (see .prakto-cover in
 * styles/prakto-theme.css), so one component works from a 100px header chip
 * to the full-width hero on the course page; below ~180px only the mark shows.
 */

// Six distinct jackets: wine, navy, green, charcoal, bronze, claret.
const PALETTES = [
  { bg: 'var(--color-wine-900)', glow: 'var(--color-wine-700)', accent: 'var(--color-wine-300)' },
  { bg: 'var(--color-ink-900)', glow: 'var(--color-ink-700)', accent: 'var(--color-ink-300)' },
  { bg: 'var(--color-forest-900)', glow: 'var(--color-forest-700)', accent: 'var(--color-forest-300)' },
  { bg: 'var(--color-warm-800)', glow: 'var(--color-warm-600)', accent: 'var(--color-ochre-300)' },
  { bg: 'var(--color-ochre-900)', glow: 'var(--color-ochre-700)', accent: 'var(--color-ochre-200)' },
  { bg: 'var(--color-wine-700)', glow: 'var(--color-wine-500)', accent: 'var(--color-wine-200)' },
]

// FNV-1a: spreads similar names ("Deep ...", "Neural ...") across the
// palettes far better than a plain multiplicative hash.
function pickPalette(seed: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return PALETTES[(hash >>> 0) % PALETTES.length]
}

/** The eight-ray star from the Prakto mark. */
function StarMark({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <g stroke={color} strokeWidth="1.4" strokeLinecap="round">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
        <line x1="19.1" y1="4.9" x2="4.9" y2="19.1" />
      </g>
    </svg>
  )
}

interface CourseCoverProps {
  title: string
  /** Small line above the title, e.g. the programme. Defaults to the academy name. */
  eyebrow?: string
  /** Picks the colour. Pass the programme so its courses share one jacket. */
  paletteSeed?: string
  /** Artwork only: no title or eyebrow, for places that print the title beside it. */
  art?: boolean
  className?: string
}

export default function CourseCover({ title, eyebrow = 'Prakto Akademi', paletteSeed, art = false, className }: CourseCoverProps) {
  const palette = pickPalette(paletteSeed || title || '')
  return (
    <div
      className={cn('prakto-cover relative w-full h-full overflow-hidden select-none', className)}
      style={{
        backgroundColor: palette.bg,
        backgroundImage: `radial-gradient(110% 90% at 100% 0%, color-mix(in oklch, ${palette.glow} 55%, transparent), transparent 65%)`,
      }}
      role="img"
      aria-label={title}
    >
      {/* Large faint star bleeding off the top-right corner, like a seal. */}
      <StarMark color={palette.accent} className="prakto-cover__seal absolute opacity-[0.16]" />
      {!art && <div className="prakto-cover__text absolute inset-0 flex flex-col justify-end">
        <span className="prakto-cover__rule block" style={{ backgroundColor: palette.accent }} />
        <span className="prakto-cover__eyebrow uppercase" style={{ color: palette.accent }}>
          {eyebrow}
        </span>
        <span className="prakto-cover__title text-white" dir="auto">
          {title}
        </span>
      </div>}
      <StarMark color={palette.accent} className={cn('prakto-cover__mark absolute', art && 'is-art')} />
    </div>
  )
}
