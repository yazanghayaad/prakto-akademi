'use client'

import { useTranslation } from 'react-i18next'
import { Sparkle } from '@phosphor-icons/react'
import { useAtlasMini } from './AtlasMiniContext'

/** Opens the Atlas side panel from the course overview toolbar. */
export default function AtlasToggleButton() {
  const { t } = useTranslation()
  const { available, toggle, focusInput } = useAtlasMini()
  if (!available) return null
  return (
    <>
      <div className="w-px self-stretch bg-neutral-200/80" />
      <button
        type="button"
        onClick={() => {
          toggle()
          focusInput()
        }}
        title={t('dashboard.atlas.open_side_panel')}
        aria-label={t('dashboard.atlas.open_side_panel')}
        className="px-2.5 sm:px-3.5 py-2 text-sm font-semibold text-neutral-800 bg-neutral-50/70 hover:bg-neutral-100/70 transition-colors flex items-center space-x-1.5"
      >
        <Sparkle className="w-4 h-4" weight="fill" />
        <span className="hidden sm:inline">{t('dashboard.atlas.title')}</span>
      </button>
    </>
  )
}
