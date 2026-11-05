import '../styles/globals.css'
import React from 'react'
import type { Metadata, Viewport } from 'next'
import Providers from '@components/Providers'
import { Source_Sans_3, Source_Serif_4, Tajawal } from 'next/font/google'

// Prakto Akademi type pairing: Source Sans 3 for interface and running text,
// Source Serif 4 (with optical sizing) for headings. Same superfamily, so the
// two share proportions and sit together without fighting.
const sourceSans = Source_Sans_3({
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
  variable: '--font-default',
})

const sourceSerif = Source_Serif_4({
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-serif-face',
})

// Wix Madefor Text has no Arabic subset, so Arabic would otherwise fall back to
// whatever the OS provides (Geeza Pro, Segoe UI, Noto) and look like a
// different product on every platform.
//
// Tajawal is the Arabic face for the whole product. It is FORCED whenever the
// UI is Arabic (see globals.css), not merely offered as a fallback: Tajawal
// ships a Latin subset too, so a mixed Arabic screen renders in one typeface
// instead of switching per glyph between two designs with different
// proportions.
//
// Weights are 200-900 with no 600, so a `font-semibold` element rounds up to 700,
// which is the intended reading.
const tajawal = Tajawal({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '700', '800'],
  display: 'swap',
  variable: '--font-arabic',
  // Only RTL/Arabic screens use it, so don't make every visitor download it.
  preload: false,
})

// viewport-fit=cover lets the phone shell paint under the notch and home
// indicator; the bars pad themselves with env(safe-area-inset-*). Pinch zoom
// stays enabled: inputs are 16px on phones so focusing one never auto-zooms.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fbfaf8',
}

// Saved to the home screen, the app opens without browser chrome.
export const metadata: Metadata = {
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // `dir` is deliberately absent from the <html> below. React only reconciles
  // attributes present in its virtual tree, so leaving it out means React never
  // clobbers what dir-init.js wrote before paint. `lang="sv"` stays as the
  // no-JS baseline for crawlers; the script overwrites it for everyone else.
  return (
    <html
      className={`${sourceSans.variable} ${sourceSerif.variable} ${tajawal.variable}`}
      lang="sv"
      suppressHydrationWarning
    >
      <head>
        {/* Synchronous script: sets <html lang/dir> before body paints so an
            RTL locale never flashes an LTR layout. Must run first. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/dir-init.js" />
        {/* Synchronous script: blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            Reads the optional ?bgcolor param (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/embed-bg.js" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
