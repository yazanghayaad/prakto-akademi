'use client'

// Open-source Atlas (components/Atlas) in place of the Enterprise stub.
import { Suspense } from 'react'
import Atlas from '@components/Atlas/AtlasPage'

export default function AtlasPage() {
  return (
    <Suspense fallback={null}>
      <Atlas />
    </Suspense>
  )
}
