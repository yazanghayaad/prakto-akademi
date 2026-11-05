'use client'
import Link from 'next/link'
import React, { ReactNode } from 'react'

export interface BreadcrumbItem {
  label: string
  href?: string
  icon?: ReactNode
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

// Prakto: a plain line of text, not a boxed control. Quiet grey links, a thin
// slash between them, the current page in ink.
const Divider = () => (
  <span className="text-gray-300 select-none" aria-hidden="true">/</span>
)

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center min-w-0 max-w-full">
      <ol className="flex items-center gap-2 min-w-0 max-w-full text-[13px]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1
          const isFirst = index === 0

          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <li className="flex items-center shrink-0">
                  <Divider />
                </li>
              )}
              {/* min-w-0 lets a long trail shrink to the phone's width;
                  the last crumb gives way first. */}
              <li className={`flex items-center h-8 ${isLast ? 'min-w-0' : 'shrink-0'}`}>
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className={`flex items-center text-gray-500 hover:text-gray-900 underline-offset-4 hover:underline transition-colors ${
                      isFirst && item.icon ? 'gap-1.5' : ''
                    }`}
                  >
                    {item.icon}
                    <span className="truncate max-w-[110px] sm:max-w-[180px]">{item.label}</span>
                  </Link>
                ) : (
                  <span aria-current="page" className={`flex items-center min-w-0 font-medium text-gray-800 ${
                    isFirst && item.icon ? 'gap-1.5' : ''
                  }`}>
                    {item.icon}
                    <span className="truncate max-w-[260px]">{item.label}</span>
                  </span>
                )}
              </li>
            </React.Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumbs
