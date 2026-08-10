'use client'

import React, { useEffect, useState } from 'react'
import { ShimmerEffect } from '@payloadcms/ui'

import { formatDate } from '../utils.js'

export function FormattedDate({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    setLabel(formatDate(iso))
  }, [iso])

  if (label === null) {
    return <ShimmerEffect height={12} width={120} />
  }

  return <span className="al-row__time">{label}</span>
}
