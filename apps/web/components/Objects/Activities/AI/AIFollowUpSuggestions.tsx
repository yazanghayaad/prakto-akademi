'use client'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { CornerDownRight } from 'lucide-react'

type AIFollowUpSuggestionsProps = {
  suggestions: string[]
  onSuggestionClick: (suggestion: string) => void
  disabled?: boolean
}

function AIFollowUpSuggestions({
  suggestions,
  onSuggestionClick,
  disabled = false,
}: AIFollowUpSuggestionsProps) {
  const { t } = useTranslation()
  if (!suggestions || suggestions.length === 0) {
    return null
  }

  return (
    <div className="border-t border-gray-200 pt-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        {t('ai.follow_up_suggestions')}
      </p>
      <div className="flex flex-col gap-1.5">
        {suggestions.map((suggestion, index) => (
          <motion.button
            key={`${suggestion}-${index}`}
            type="button"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut', delay: index * 0.06 }}
            onClick={() => !disabled && onSuggestionClick(suggestion)}
            disabled={disabled}
            className={`group flex w-full items-start gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-start text-[13px] leading-snug text-gray-700 transition-colors ${
              disabled
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer hover:border-wine-300 hover:bg-wine-50 hover:text-wine-900'
            }`}
          >
            <CornerDownRight
              size={14}
              className="mt-0.5 shrink-0 text-gray-400 transition-colors group-hover:text-wine-700"
            />
            <span>{suggestion}</span>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

export default AIFollowUpSuggestions
