'use client'

import React from 'react'
import { useTranslation } from '@payloadcms/ui'

import { formatValue, isLongValue } from '../utils.js'
import type { CustomTranslationsKeys, CustomTranslationsObject } from '../../../translations/index.js'

type Props = {
  diff: Record<string, { after: unknown; before: unknown }>
}

export function DiffViewer({ diff }: Props) {
  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
  const entries = Object.entries(diff)
  if (entries.length === 0) return null

  return (
    <table className="al-diff">
      <thead>
        <tr>
          <th className="al-diff__th al-diff__col-path">{t('auditPlugin:diffPath')}</th>
          <th className="al-diff__th al-diff__col-before">{t('auditPlugin:diffBefore')}</th>
          <th className="al-diff__th al-diff__col-after">{t('auditPlugin:diffAfter')}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([path, { before, after }]) => (
          <tr className="al-diff__row" key={path}>
            <td className="al-diff__td al-diff__col-path">
              <code className="al-diff__path">{path}</code>
            </td>
            <td className="al-diff__td al-diff__col-before">
              {isLongValue(before) ? (
                <pre className="al-diff__json">{formatValue(before)}</pre>
              ) : (
                <span className="al-diff__scalar al-diff__scalar--before">
                  {formatValue(before)}
                </span>
              )}
            </td>
            <td className="al-diff__td al-diff__col-after">
              {isLongValue(after) ? (
                <pre className="al-diff__json">{formatValue(after)}</pre>
              ) : (
                <span className="al-diff__scalar al-diff__scalar--after">{formatValue(after)}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
