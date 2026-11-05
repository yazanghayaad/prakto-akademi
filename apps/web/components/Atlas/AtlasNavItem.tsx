'use client'

import Link from 'next/link'
import { useTranslation } from 'react-i18next'
import { Sparkle } from '@phosphor-icons/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAtlasMini } from './AtlasMiniContext'

/** Sidebar link to the Atlas page, styled like the other dashboard menu links. */
export default function AtlasNavItem({ isCollapsed, isActive }: { isCollapsed: boolean; isActive: boolean }) {
  const { t } = useTranslation()
  const { available } = useAtlasMini()
  if (!available) return null
  const label = t('dashboard.atlas.title')

  const link = (
    <Link href="/dash/atlas" aria-label={label} aria-current={isActive ? 'page' : undefined}>
      <div
        className={cn(
          'relative flex items-center w-full rounded-lg transition-all',
          isActive ? 'text-white bg-white/[0.08]' : 'text-white/50 hover:text-white hover:bg-white/[0.08]',
          isCollapsed ? 'justify-center h-10' : 'px-3 py-2 gap-3'
        )}
      >
        {isActive && (
          <span aria-hidden="true" className="absolute start-0.5 top-1/2 -translate-y-1/2 h-5 w-[3px] bg-white rounded-full" />
        )}
        <Sparkle size={20} weight="fill" />
        {!isCollapsed && <span className="text-sm font-medium">{label}</span>}
      </div>
    </Link>
  )

  if (!isCollapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right" className="z-tooltip bg-[#1a1a1b] border-white/10 text-white text-xs px-2 py-1">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
