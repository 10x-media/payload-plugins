'use client'

import React, { useCallback, useState } from 'react'
import { Button, DatePicker, useTranslation } from '@payloadcms/ui'

import type { CustomTranslationsKeys, CustomTranslationsObject } from '../../../../translations/index.js'

import type { EditorProps } from './types.js'

export function DateRangeEditor({ onClose, setStaged, staged }: EditorProps) {
  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
  const [from, setFrom] = useState<Date | string>(staged.dateFrom ?? '')
  const [to, setTo] = useState<Date | string>(staged.dateTo ?? '')

  const toISO = (val: Date | string): string | undefined => {
    if (!val) return undefined
    if (val instanceof Date) return val.toISOString()
    return val
  }

  const commit = useCallback(() => {
    setStaged((f) => ({
      ...f,
      dateFrom: toISO(from),
      dateTo: toISO(to),
    }))
    onClose()
  }, [from, to, onClose, setStaged])

  return (
    <div className="al-filterpopover__editor" data-popup-prevent-close>
      <div className="al-filterpopover__editor-label">{t('auditPlugin:filterDateRange')}</div>
      <div className="al-filterpopover__date-row">
        <span className="al-filterpopover__date-label">{t('auditPlugin:dateFrom')}</span>
        <DatePicker onChange={(val) => setFrom(val as Date | string)} placeholder={t('auditPlugin:startDate')} value={from} />
      </div>
      <div className="al-filterpopover__date-row">
        <span className="al-filterpopover__date-label">{t('auditPlugin:dateTo')}</span>
        <DatePicker onChange={(val) => setTo(val as Date | string)} placeholder={t('auditPlugin:endDate')} value={to} />
      </div>
      <div className="al-filterpopover__actions">
        <Button buttonStyle="primary" margin={false} onClick={commit}>
          {t('auditPlugin:apply')}
        </Button>
      </div>
    </div>
  )
}
