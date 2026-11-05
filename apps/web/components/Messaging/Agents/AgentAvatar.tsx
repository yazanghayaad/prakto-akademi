'use client'

import React from 'react'
import type { AgentSummary } from '@services/messaging/messaging'

export type AgentAvatarProps = {
  agent: Pick<AgentSummary, 'emoji' | 'color' | 'secondary_color' | 'name'> & { is_default?: boolean }
  size?: number
  className?: string
}

/** The LearnHouse AI mark. Copilot no longer wears it here (see below). */
export const COPILOT_LOGO = '/learnhouse_ai_simple_colored.png'

/** An agent's face: its two colors as a rounded tile, its emoji on top. Copilot wears the Prakto star on wine. */
export default function AgentAvatar({ agent, size = 36, className = '' }: AgentAvatarProps) {
  const radius = Math.max(4, Math.round(size * 0.18))
  if (agent.is_default) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 select-none bg-wine-900 ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
        role="img"
        aria-label={agent.name}
        title={agent.name}
      >
        <svg viewBox="0 0 24 24" style={{ width: Math.round(size * 0.56), height: Math.round(size * 0.56) }} aria-hidden="true">
          <g stroke="var(--color-wine-100)" strokeWidth={size < 24 ? 2.6 : 2} strokeLinecap="round">
            <line x1="12" y1="2" x2="12" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <line x1="4.9" y1="4.9" x2="19.1" y2="19.1" />
            <line x1="19.1" y1="4.9" x2="4.9" y2="19.1" />
          </g>
        </svg>
      </span>
    )
  }
  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 select-none overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: `linear-gradient(140deg, ${agent.color} 0%, ${agent.secondary_color} 100%)`,
      }}
      role="img"
      aria-label={agent.name}
      title={agent.name}
    >
      <span className="relative leading-none" style={{ fontSize: Math.round(size * 0.52) }}>
        {agent.emoji || '✨'}
      </span>
    </div>
  )
}
