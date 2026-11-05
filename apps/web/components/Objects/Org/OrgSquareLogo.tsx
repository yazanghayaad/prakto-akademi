'use client'
import React from 'react'
import { getOrgLogoMediaDirectory, getOrgSquareLogoMediaDirectory } from '@services/media/media'
import { cn } from '@/lib/utils'

/**
 * The square logo lives on the org config (next to the favicon) rather than
 * on the org row, so it is read from either config shape.
 */
export function getOrgSquareLogoFile(org: any): string {
  return (
    org?.config?.config?.customization?.general?.square_logo_image ||
    org?.config?.config?.general?.square_logo_image ||
    ''
  )
}

export function getOrgSquareLogoUrl(org: any): string | null {
  const file = getOrgSquareLogoFile(org)
  return file && org?.org_uuid ? getOrgSquareLogoMediaDirectory(org.org_uuid, file) : null
}

export function getOrgWideLogoUrl(org: any): string | null {
  return org?.logo_image && org?.org_uuid
    ? getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)
    : null
}

/** True when the org has any logo to show in a square box. */
export function hasOrgLogo(org: any): boolean {
  return Boolean(org?.logo_image || getOrgSquareLogoFile(org))
}

/** First letter of the org name on a neutral tile; the no-logo fallback for white-label plans. */
export function OrgInitial({ org, className }: { org: any; className?: string }) {
  return (
    <span
      className={cn(
        'w-full h-full bg-gray-100 text-gray-700 font-bold flex items-center justify-center',
        className
      )}
    >
      {(org?.name || '?').charAt(0).toUpperCase()}
    </span>
  )
}

interface OrgSquareLogoProps {
  org: any
  /** Rendered when the org has neither a square nor a wide logo. */
  fallback: React.ReactNode
  /** Extra classes on the <img>. Sizing comes from the parent box. */
  className?: string
  /** Inset applied when the wide logo has to sit inside a square box. */
  wideInsetClassName?: string
  alt?: string
  /** Load the image in CORS mode so it can be drawn onto a canvas (PDF export). */
  crossOrigin?: 'anonymous'
}

// The media host only sends CORS headers when the request carries an Origin,
// and the browser cache does not split entries by request mode. A logo first
// loaded by a plain <img> elsewhere on the page would then be reused for the
// CORS load and rejected, so CORS loads get their own cache entry.
function corsSafeUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}cors=1`
}

/**
 * The logo with its empty (transparent or white) margins cut away, so it can
 * be centred on its ink rather than on whatever padding the uploaded file has.
 * Returns the original URL until the trim is ready, or for good if the media
 * host refuses the CORS load (the canvas would be tainted).
 */
export function useTrimmedLogo(url: string | null): string | null {
  const [trimmed, setTrimmed] = React.useState<{ src: string; data: string } | null>(null)
  React.useEffect(() => {
    if (!url) return
    let cancelled = false
    const img = new window.Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const w = img.naturalWidth
        const h = img.naturalHeight
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx || !w || !h) return
        ctx.drawImage(img, 0, 0)
        const px = ctx.getImageData(0, 0, w, h).data
        let x0 = w, y0 = h, x1 = -1, y1 = -1
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            if (px[i + 3] > 40 && Math.min(px[i], px[i + 1], px[i + 2]) < 235) {
              if (x < x0) x0 = x
              if (x > x1) x1 = x
              if (y < y0) y0 = y
              if (y > y1) y1 = y
            }
          }
        }
        // Nothing to cut, or an all-white logo (meant for dark grounds): keep it.
        if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) return
        const cw = x1 - x0 + 1
        const ch = y1 - y0 + 1
        const out = document.createElement('canvas')
        out.width = cw
        out.height = ch
        out.getContext('2d')?.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch)
        if (!cancelled) setTrimmed({ src: url, data: out.toDataURL('image/png') })
      } catch {
        // Tainted canvas: the original stays.
      }
    }
    img.src = corsSafeUrl(url)
    return () => {
      cancelled = true
    }
  }, [url])
  return trimmed && trimmed.src === url ? trimmed.data : url
}

/**
 * Fills a square box with the best available logo: the square logo edge to
 * edge, otherwise the wide logo letterboxed inside the box, otherwise the
 * caller's fallback. Every place that shows the brand in a square (sign-in
 * panel, org switcher, dashboard sidebar) goes through this so the fallback
 * chain is decided once.
 */
export default function OrgSquareLogo({
  org,
  fallback,
  className,
  wideInsetClassName = 'p-[12%]',
  alt,
  crossOrigin,
}: OrgSquareLogoProps) {
  // A media host without CORS rejects the load outright; fall back to a plain
  // image so the logo still shows on screen, even if the PDF can't include it.
  const [corsFailed, setCorsFailed] = React.useState(false)
  const cors = crossOrigin && !corsFailed ? crossOrigin : undefined
  const onError = cors ? () => setCorsFailed(true) : undefined
  const toSrc = (url: string) => (cors ? corsSafeUrl(url) : url)
  const square = getOrgSquareLogoUrl(org)
  const wide = getOrgWideLogoUrl(org)
  const label = alt ?? org?.name ?? ''

  // An upload in the square slot is not always square (a wordmark put there
  // got cropped to its middle letters). Measure it once it loads and letterbox
  // it like the wide logo when it is clearly not square.
  const [notSquareSrc, setNotSquareSrc] = React.useState<string | null>(null)
  const measure = React.useCallback((el: HTMLImageElement | null) => {
    if (!el || !el.complete || !el.naturalWidth || !el.naturalHeight) return
    const ratio = el.naturalWidth / el.naturalHeight
    if (ratio > 1.2 || ratio < 1 / 1.2) setNotSquareSrc(el.getAttribute('src'))
  }, [])

  if (square) {
    const src = toSrc(square)
    // Keyed by src, so a newly uploaded (square) logo starts out unmeasured.
    const letterbox = notSquareSrc === src
    return (
      <img
        ref={measure}
        src={src}
        alt={label}
        crossOrigin={cors}
        onError={onError}
        onLoad={(e) => measure(e.currentTarget)}
        className={cn('w-full h-full', letterbox ? cn('object-contain', wideInsetClassName) : 'object-cover', className)}
      />
    )
  }
  if (wide) {
    return (
      <img
        src={toSrc(wide)}
        alt={label}
        crossOrigin={cors}
        onError={onError}
        className={cn('w-full h-full object-contain', wideInsetClassName, className)}
      />
    )
  }
  return <>{fallback}</>
}
