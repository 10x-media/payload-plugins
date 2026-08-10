'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pagination, PerPage, useStepNav, useTranslation } from '@payloadcms/ui'

import type { CustomTranslationsObject, CustomTranslationsKeys } from '../../translations/index.js'

import './index.scss'

import type { AuditLogDoc, AuditLogsClientProps } from './types.js'
import { buildParams } from './utils.js'
import { FilterBar } from './components/FilterBar/index.js'
import { LogRow } from './components/LogRow.js'

const LIMIT_OPTIONS = [10, 25, 50, 100]

export function AuditLogsClient({
  adminRoute,
  apiRoute,
  collectionSlugs,
  docs,
  totalDocs,
  totalPages,
  page,
  limit,
  filters,
  globalSlugs,
  lockedTenantId,
  tenantOptions,
  userTitleFields,
  debugMode,
  hasArchive,
}: AuditLogsClientProps) {
  const router = useRouter()
  const [runningTask, setRunningTask] = useState<'audit-logs-archive' | 'audit-logs-delete' | null>(
    null,
  )
  const [lastResult, setLastResult] = useState<string | null>(null)

  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()

  const { setStepNav } = useStepNav()

  useEffect(() => {
    setStepNav([{ label: t('auditPlugin:breadcrumb') }])
  }, [setStepNav, t])

  const triggerJob = useCallback(
    async (task: 'audit-logs-archive' | 'audit-logs-delete') => {
      setRunningTask(task)
      setLastResult(null)
      try {
        const res = await fetch(`${apiRoute}/audit-retention/run?task=${task}`, { method: 'POST' })
        const json = await res.json()
        if (res.ok) {
          setLastResult(`Queued: ${task}`)
        } else {
          setLastResult(`Error: ${json?.error ?? res.statusText}`)
        }
      } catch (err) {
        setLastResult(`Error: ${String(err)}`)
      } finally {
        setRunningTask(null)
      }
    },
    [apiRoute],
  )

  const handleFilter = useCallback(
    (newFilters: typeof filters) => {
      router.push(`?${buildParams(newFilters, undefined, limit)}`)
    },
    [router, limit],
  )


  const goToPage = useCallback(
    (newPage: number) => {
      router.push(`?${buildParams(filters, newPage, limit)}`)
    },
    [router, filters, limit],
  )

  const handleLimit = useCallback(
    (newLimit: number) => {
      router.push(`?${buildParams(filters, 1, newLimit)}`)
    },
    [router, filters],
  )

  const pageStart = page * limit - (limit - 1)
  const pageEnd = totalPages > 1 && totalPages !== page ? limit * page : totalDocs

  return (
    <div className="al-view">
      <div className="al-view__header">
        <h1 className="al-view__title">{t('auditPlugin:title')}</h1>
        <span className="al-view__count">{t('auditPlugin:entries', { count: totalDocs })}</span>
      </div>

      {debugMode && (
        <div className="al-debug-bar">
          <span className="al-debug-bar__label">{t('auditPlugin:debug')}</span>
          {hasArchive && (
            <button
              className="al-debug-bar__btn"
              disabled={runningTask !== null}
              onClick={() => triggerJob('audit-logs-archive')}
              type="button"
            >
              {runningTask === 'audit-logs-archive' ? t('auditPlugin:queuing') : t('auditPlugin:runArchive')}
            </button>
          )}
          <button
            className="al-debug-bar__btn al-debug-bar__btn--danger"
            disabled={runningTask !== null}
            onClick={() => triggerJob('audit-logs-delete')}
            type="button"
          >
            {runningTask === 'audit-logs-delete' ? t('auditPlugin:queuing') : t('auditPlugin:runDelete')}
          </button>
          {lastResult && <span className="al-debug-bar__result">{lastResult}</span>}
        </div>
      )}

      <FilterBar
        collectionSlugs={collectionSlugs}
        filters={filters}
        globalSlugs={globalSlugs}
        onFilter={handleFilter}
        tenantOptions={lockedTenantId ? undefined : tenantOptions}
        userTitleFields={userTitleFields}
      />

      <div className="al-list">
        {docs.length === 0 ? (
          <div className="al-list__empty">{t('auditPlugin:noEntries')}</div>
        ) : (
          docs.map((doc) => (
            <LogRow
              adminRoute={adminRoute}
              doc={doc as unknown as AuditLogDoc}
              key={String(doc.id)}
              userTitleFields={userTitleFields}
            />
          ))
        )}
      </div>

      {totalDocs > 0 && (
        <div className="al-pagination">
          <Pagination
            hasNextPage={page < totalPages}
            hasPrevPage={page > 1}
            nextPage={page + 1}
            onChange={goToPage}
            page={page}
            prevPage={page - 1}
            totalPages={totalPages}
          />
          <div className="al-pagination__info">
            {t('auditPlugin:paginationInfo', { from: pageStart, to: pageEnd, total: totalDocs })}
          </div>
          <PerPage handleChange={handleLimit} limit={limit} limits={LIMIT_OPTIONS} />
        </div>
      )}
    </div>
  )
}
