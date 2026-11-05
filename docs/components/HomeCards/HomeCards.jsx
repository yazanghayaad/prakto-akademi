'use client'

import Link from 'next/link'
import {
  RocketLaunch,
  Student,
  BookOpen,
  UsersThree,
} from '@phosphor-icons/react/dist/ssr'

const cards = [
  {
    href: '/getting-started',
    icon: RocketLaunch,
    color: '#7a1f1f',
    title: 'Kom igång',
    desc: 'Logga in, hitta din första kurs och kom igång på några minuter',
    pattern: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
    patternSize: '14px 14px',
  },
  {
    href: '/platform/courses/taking-a-course',
    icon: Student,
    color: '#1f3a5f',
    title: 'Studera en kurs',
    desc: 'Moduler, framsteg, quiz och certifikat',
    pattern: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
    patternSize: '20px 20px',
  },
  {
    href: '/platform/courses',
    icon: BookOpen,
    color: '#2f5d46',
    title: 'Skapa kurser',
    desc: 'Kapitel, aktiviteter, redigeraren och biblioteket',
    pattern: 'repeating-linear-gradient(45deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 8px)',
    patternSize: '12px 12px',
  },
  {
    href: '/platform/users',
    icon: UsersThree,
    color: '#a8741a',
    title: 'Administration',
    desc: 'Användare, roller, grupper och inställningar',
    pattern: 'repeating-linear-gradient(0deg, currentColor 0px, currentColor 1px, transparent 1px, transparent 6px)',
    patternSize: '6px 6px',
  },
]

export default function HomeCards() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, margin: '32px 0' }}>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Link
            key={card.href}
            href={card.href}
            className="nice-shadow"
            style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '22px 24px',
              borderRadius: 16,
              background: '#fff',
              overflow: 'hidden',
              position: 'relative',
              textDecoration: 'none',
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
          >
            {/* Pattern */}
            <div
              style={{
                position: 'absolute', inset: 0,
                pointerEvents: 'none',
                opacity: 0.05,
                color: card.color,
                backgroundImage: card.pattern,
                backgroundSize: card.patternSize,
                maskImage: 'linear-gradient(to right, black 0%, transparent 60%)',
                WebkitMaskImage: 'linear-gradient(to right, black 0%, transparent 60%)',
              }}
            />

            {/* Icon */}
            <div
              style={{
                position: 'relative', zIndex: 1,
                flexShrink: 0,
                width: 42, height: 42,
                borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: card.color + '10',
              }}
            >
              <Icon size={20} weight="duotone" style={{ color: card.color }} />
            </div>

            {/* Text */}
            <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 650, color: '#1c1a17', lineHeight: 1.3, margin: 0 }}>{card.title}</div>
              <div style={{ fontSize: 13, color: '#7a726b', lineHeight: 1.45, margin: 0, marginTop: 3 }}>{card.desc}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
