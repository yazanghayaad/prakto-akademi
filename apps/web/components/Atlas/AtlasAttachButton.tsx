'use client'

import { useTranslation } from 'react-i18next'
import { Sparkle } from '@phosphor-icons/react'
import { useAtlasMini } from './AtlasMiniContext'
import type { AtlasReference } from './types'

/** Attaches a chapter or activity to the Atlas input and opens the side panel. */
export default function AtlasAttachButton({ reference }: { reference: AtlasReference }) {
  const { t } = useTranslation()
  const { available, attachReference, focusInput } = useAtlasMini()
  if (!available) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        attachReference(reference)
        focusInput()
      }}
      title={t('dashboard.atlas.picker.attach')}
      aria-label={t('dashboard.atlas.picker.attach')}
      className="text-neutral-400 hover:text-neutral-900 hover:cursor-pointer"
    >
      <Sparkle size={15} weight="fill" />
    </button>
  )
}
