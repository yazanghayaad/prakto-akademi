'use client'

import Sidebar from '../Sidebar/Sidebar'
import TOC from '../TOC/TOC'
import { useConfig } from 'nextra-theme-docs'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

function Breadcrumb() {
  const config = useConfig()
  const { activePath } = config.normalizePagesResult

  if (!activePath || activePath.length <= 1) return null

  // Nextra emits both a folder entry and its index page with the same route
  // (e.g. /developers/migration appears twice once you open /developers/migration).
  // Collapse consecutive duplicates so React keys stay unique and the trail
  // does not show the same crumb twice.
  const trail = activePath.filter((item, i, arr) => {
    const next = arr[i + 1]
    return !next || next.route !== item.route
  })

  return (
    <nav className="lh-breadcrumb" aria-label="Brödsmulor">
      {trail.map((item, i) => {
        const isLast = i === trail.length - 1
        const title = typeof item.title === 'string' ? item.title : item.name
        return (
          <span key={`${item.route || ''}-${i}`} className="lh-breadcrumb-item">
            {i > 0 && <span className="lh-breadcrumb-sep">/</span>}
            {isLast ? (
              <span className="lh-breadcrumb-current">{title}</span>
            ) : (
              <Link href={item.route || '#'} className="lh-breadcrumb-link">
                {title}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

function Pagination() {
  const config = useConfig()
  const { flatDocsDirectories, activeIndex } = config.normalizePagesResult

  const prev = activeIndex > 0 ? flatDocsDirectories[activeIndex - 1] : null
  const next = activeIndex < flatDocsDirectories.length - 1 ? flatDocsDirectories[activeIndex + 1] : null

  if (!prev && !next) return null

  return (
    <div className="lh-pagination">
      {prev ? (
        <Link href={prev.route} className="lh-pagination-link lh-pagination-prev">
          <span className="lh-pagination-label">Föregående</span>
          <span className="lh-pagination-title">
            {typeof prev.title === 'string' ? prev.title : prev.name}
          </span>
        </Link>
      ) : <div />}
      {next ? (
        <Link href={next.route} className="lh-pagination-link lh-pagination-next">
          <span className="lh-pagination-label">Nästa</span>
          <span className="lh-pagination-title">
            {typeof next.title === 'string' ? next.title : next.name}
          </span>
        </Link>
      ) : <div />}
    </div>
  )
}

function LastEdited({ timestamp }) {
  if (!timestamp) return null

  const date = new Date(timestamp).toLocaleDateString('sv-SE', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="lh-last-edited">
      Senast ändrad {date}
    </div>
  )
}

function HelpCard() {
  return (
    <a
      href="https://status.prakto.se/bugs/new"
      target="_blank"
      rel="noopener noreferrer"
      className="lh-help-card group block nice-shadow rounded-xl overflow-hidden bg-white! no-underline! relative"
    >
      <div className="relative p-4">
        <img src="/docs/img/logos/prakto.png" alt="Prakto Akademi" className="h-3.5" style={{ marginBottom: 14 }} />
        <p className="text-[12.5px] font-semibold text-neutral-900! leading-snug m-0!">
          Hittar du inte svaret?
        </p>
        <p className="mt-1.5 text-[11px] text-neutral-500! leading-relaxed m-0!">
          Rapportera ett problem eller ge oss feedback, så hjälper vi dig.
        </p>
        <div className="lh-help-card-cta mt-3 inline-flex items-center gap-1 text-[11px] font-semibold group-hover:gap-2 transition-all">
          Rapportera problem
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </div>
    </a>
  )
}

export default function Wrapper({ children, toc, metadata }) {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <div className="lh-page">
      <Sidebar />
      <div className="lh-content-area">
        <article className="lh-article">
          <div className="lh-article-header">
            <Breadcrumb />
          </div>
          {/* Only the article goes into the search index, not the menus around it. */}
          <div className="lh-prose" data-pagefind-body>
            {children}
          </div>
          {!isHome && (
            <div className="lh-article-footer">
              <LastEdited timestamp={metadata?.timestamp} />
            </div>
          )}
          <Pagination />
        </article>
        <div className="lh-toc">
          {toc && toc.length > 0 && (
            <TOC headings={toc} />
          )}
          <HelpCard />
        </div>
      </div>
    </div>
  )
}
