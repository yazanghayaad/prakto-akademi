'use client'

import Link from 'next/link'

const links = [
  { label: 'Dokumentation', href: '/' },
  { label: 'Prakto webbplats', href: 'https://prakto.se/' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/showcase/prakto-1' },
  { label: 'Rapportera problem', href: 'https://status.prakto.se/bugs/new' },
]

export default function Footer() {
  return (
    <footer className="lh-footer">
      <div className="lh-footer-container">
        <p className="lh-footer-copyright">
          &copy; {new Date().getFullYear()} Prakto Akademi
        </p>
        <nav className="lh-footer-nav">
          {links.map((link) => {
            const isExternal = link.href.startsWith('http')
            const Tag = isExternal ? 'a' : Link
            const props = isExternal
              ? { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
              : { href: link.href }
            return (
              <Tag key={link.label} {...props} className="lh-footer-link">
                {link.label}
              </Tag>
            )
          })}
        </nav>
      </div>
    </footer>
  )
}
