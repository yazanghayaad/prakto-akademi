'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Search } from 'nextra/components'
import { ArrowUpRight, List, X, Globe, RocketLaunch, AppWindow, LinkedinLogo, ChatCircleDots } from '@phosphor-icons/react/dist/ssr'

function Navbar() {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  useEffect(() => setMounted(true), [])

  // Close mobile menu on route change
  useEffect(() => {
    const handleRouteChange = () => setMobileMenuOpen(false)
    window.addEventListener('popstate', handleRouteChange)
    return () => window.removeEventListener('popstate', handleRouteChange)
  }, [])

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileMenuOpen])

  const logoSrc = '/docs/img/logos/prakto.png'

  // Prakto: the academy's own destinations instead of LearnHouse's.
  const internal = [
    { href: '/getting-started', label: 'Kom igång', Icon: RocketLaunch },
    { href: '/platform', label: 'Plattformen', Icon: AppWindow },
  ]
  const external = [
    { href: 'https://prakto.se/', label: 'Prakto webbplats', Icon: Globe },
  ]
  const right = [
    { href: 'https://www.linkedin.com/showcase/prakto-1', label: 'LinkedIn', Icon: LinkedinLogo },
    { href: 'https://status.prakto.se/bugs/new', label: 'Rapportera problem', Icon: ChatCircleDots },
  ]

  return (
    <>
      <div className="lh-navbar">
        <div className="lh-navbar-inner">
          {/* Left: logo + nav */}
          <div className="lh-navbar-left">
            <Link href="/" className="lh-navbar-logo">
              {mounted ? (
                <img src={logoSrc} alt="Prakto Akademi" />
              ) : (
                <div style={{ width: 82, height: 20 }} />
              )}
            </Link>

            <span className="lh-navbar-badge">docs</span>

            <nav className="lh-navbar-nav lh-hide-mobile">
              {internal.map(({ href, label, Icon }) => (
                <Link key={href} href={href} className="lh-navbar-nav-item">
                  <Icon size={15} weight="fill" />
                  {label}
                </Link>
              ))}
              {external.map(({ href, label, Icon }) => (
                <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="lh-navbar-nav-item">
                  <Icon size={15} weight="fill" />
                  {label}
                  <ArrowUpRight size={11} weight="bold" />
                </a>
              ))}
            </nav>
          </div>

          {/* Right: search + links + hamburger */}
          <div className="lh-navbar-right">
            <Search className="lh-navbar-search" placeholder="Sök i dokumentationen…" />
            {right.map(({ href, label, Icon }) => (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="lh-navbar-nav-item lh-hide-mobile">
                <Icon size={16} weight="fill" />
                {label}
              </a>
            ))}

            {/* Mobile hamburger */}
            <button
              className="lh-mobile-menu-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? 'Stäng menyn' : 'Öppna menyn'}
            >
              {mobileMenuOpen ? <X size={20} weight="bold" /> : <List size={20} weight="bold" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="lh-mobile-overlay" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* Mobile sidebar drawer */}
      <div className={`lh-mobile-drawer ${mobileMenuOpen ? 'lh-mobile-drawer-open' : ''}`}>
        <div className="lh-mobile-drawer-links">
          {internal.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="lh-mobile-drawer-link" onClick={() => setMobileMenuOpen(false)}>
              <Icon size={16} weight="fill" />
              {label}
            </Link>
          ))}
          {[...external, ...right].map(({ href, label, Icon }) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="lh-mobile-drawer-link">
              <Icon size={16} weight="fill" />
              {label}
              <ArrowUpRight size={12} weight="bold" />
            </a>
          ))}
        </div>
        <div className="lh-mobile-drawer-sidebar" id="mobile-sidebar-mount" />
      </div>
    </>
  )
}

export default Navbar
