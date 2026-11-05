'use client'

import Link from 'next/link'
import {
  PencilSimple,
  Brain,
  BookOpen,
  ClipboardText,
  Terminal,
  ChatCircle,
  ChalkboardSimple,
  Microphone,
  Certificate,
  ChartBar,
  MagnifyingGlass,
  Path,
} from '@phosphor-icons/react/dist/ssr'

const features = [
  // Row 1: hero features (large)
  { icon: BookOpen, label: 'Kurser och lärvägar', desc: 'Kurser i moduler, samlade i program som du följer kurs för kurs', color: '#7a1f1f', size: 'large', href: '/platform/courses' },
  { icon: PencilSimple, label: 'Redigeraren', desc: 'Bygg lektioner med text, video, dokument, quiz och interaktiva block', color: '#1f3a5f', size: 'large', href: '/platform/editor' },
  { icon: Brain, label: 'AI-stöd', desc: 'Fråga AI om det du läser, och låt lärare få hjälp att skapa innehåll', color: '#2f5d46', size: 'large', href: '/platform/ai' },
  // Standard features
  { icon: Path, label: 'Lärvägar', desc: 'Hela program i rätt ordning', color: '#7a1f1f', href: '/platform/paths' },
  { icon: ClipboardText, label: 'Uppgifter', desc: 'Inlämning och bedömning', color: '#a8741a', href: '/platform/assignments' },
  { icon: Terminal, label: 'Kodkörning', desc: 'Kör kod direkt i lektionen', color: '#1f3a5f', href: '/platform/code-execution' },
  { icon: ChatCircle, label: 'Communities', desc: 'Diskussioner och svar', color: '#2f5d46', href: '/platform/discussions' },
  { icon: ChalkboardSimple, label: 'Tavlor', desc: 'Gemensamma whiteboards', color: '#a8741a', href: '/platform/boards' },
  { icon: Microphone, label: 'Poddar', desc: 'Ljud och avsnitt', color: '#5b5149', href: '/platform/podcasts' },
  { icon: Certificate, label: 'Certifikat', desc: 'När kursen är klar', color: '#7a1f1f', href: '/platform/certifications' },
  { icon: ChartBar, label: 'Statistik', desc: 'Framsteg och aktivitet', color: '#1f3a5f', href: '/platform/analytics' },
]

function FeatureCard({ icon: Icon, label, color, desc, large, href }) {
  return (
    <Link
      href={href}
      style={{
        padding: large ? '24px 26px' : '18px 20px',
        borderRadius: 16,
        background: '#fff',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: large ? 14 : 10,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)',
        textDecoration: 'none',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.03)' }}
    >
      {/* Dot pattern */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          opacity: 1,
          backgroundImage: `radial-gradient(${color}30 1px, transparent 1px)`,
          backgroundSize: '14px 14px',
          maskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, transparent 50%)',
        }}
      />

      <div
        style={{
          width: large ? 40 : 34,
          height: large ? 40 : 34,
          borderRadius: large ? 12 : 10,
          background: color + '10',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Icon size={large ? 20 : 17} weight="duotone" style={{ color }} />
      </div>

      <div>
        <div style={{ fontSize: large ? 15 : 13, fontWeight: 650, color: '#1c1a17', lineHeight: 1.3, margin: 0 }}>
          {label}
        </div>
        <div style={{ fontSize: large ? 13 : 11.5, color: '#7a726b', lineHeight: 1.45, margin: 0, marginTop: 3 }}>
          {desc}
        </div>
      </div>
    </Link>
  )
}

export default function FeaturesGrid() {
  const heroFeatures = features.filter(f => f.size === 'large')
  const standardFeatures = features.filter(f => !f.size)

  return (
    <div style={{ margin: '24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Hero row: 3 large cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {heroFeatures.map(f => (
          <FeatureCard key={f.label} {...f} large />
        ))}
      </div>

      {/* Standard features: compact bento grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {standardFeatures.map(f => (
          <FeatureCard key={f.label} {...f} />
        ))}
      </div>
    </div>
  )
}
