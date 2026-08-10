'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Button, Popup, useTranslation } from '@payloadcms/ui'

import type { Filters } from '../../types.js'
import { OPERATION_LABELS } from '../../utils.js'
import type { AvailableFilter, FilterBarProps } from './types.js'
import type { CustomTranslationsKeys, CustomTranslationsObject } from '../../../../translations/index.js'
import { AddFilterPopup } from './AddFilterPopup.js'
import { ValueEditor } from './ValueEditor.js'
import { formatDatePill } from './utils.js'

export function FilterBar({ collectionSlugs, filters, globalSlugs, onFilter, tenantOptions, userTitleFields }: FilterBarProps) {
  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
  const [staged, setStaged] = useState<Filters>(filters)

  useEffect(() => {
    setStaged(filters)
  }, [filters])

  const isDirty = JSON.stringify(staged) !== JSON.stringify(filters)

  const hasActiveFilters =
    (staged.collections?.length ?? 0) > 0 ||
    (staged.globals?.length ?? 0) > 0 ||
    (staged.operations?.length ?? 0) > 0 ||
    (staged.tenants?.length ?? 0) > 0 ||
    (staged.userIds?.length ?? 0) > 0 ||
    !!staged.documentId ||
    !!staged.eventType ||
    !!staged.group ||
    (staged.changedPaths?.length ?? 0) > 0 ||
    !!staged.dateFrom ||
    !!staged.dateTo

  const hasOperations = (staged.operations?.length ?? 0) > 0
  const hasAuthOp = staged.operations?.includes('auth')
  const hasCustomOp = staged.operations?.includes('custom')
  const hasGlobals = (staged.globals?.length ?? 0) > 0

  const availableToAdd: AvailableFilter[] = [
    ...((staged.collections?.length ?? 0) === 0
      ? [{ key: 'collections' as const, label: t('auditPlugin:filterCollection') }]
      : []),
    ...(globalSlugs.length > 0 && (staged.globals?.length ?? 0) === 0
      ? [{ key: 'globals' as const, label: t('auditPlugin:filterGlobal') }]
      : []),
    ...((staged.operations?.length ?? 0) === 0
      ? [{ key: 'operations' as const, label: t('auditPlugin:filterOperation') }]
      : []),
    ...(tenantOptions && tenantOptions.length > 0 && (staged.tenants?.length ?? 0) === 0
      ? [{ key: 'tenant' as const, label: t('auditPlugin:filterTenant') }]
      : []),
    ...(Object.keys(userTitleFields).length > 0 && (staged.userIds?.length ?? 0) === 0
      ? [{ key: 'userId' as const, label: t('auditPlugin:filterUser') }]
      : []),
    // documentId not available when globals filter is active (globals use documentId internally)
    ...(!staged.documentId && !hasGlobals ? [{ key: 'documentId' as const, label: t('auditPlugin:filterDocument') }] : []),
    ...(!staged.eventType && hasOperations && (hasAuthOp || hasCustomOp)
      ? [{ key: 'eventType' as const, label: t('auditPlugin:filterEventType') }]
      : []),
    { key: 'changedPath' as const, label: t('auditPlugin:filterChangedPath') },
    ...(!staged.group ? [{ key: 'group' as const, label: t('auditPlugin:filterGroup') }] : []),
    ...(!staged.dateFrom && !staged.dateTo
      ? [{ key: 'dateRange' as const, label: t('auditPlugin:filterDateRange') }]
      : []),
  ]

  const getMultiPillValue = (field: 'collections' | 'globals' | 'operations' | 'tenants' | 'userIds'): string => {
    const values = staged[field] ?? []
    if (field === 'operations') return values.map((v) => OPERATION_LABELS[v] ?? v).join(', ')
    if (field === 'userIds') return values.map((id) => `#${id.slice(-8)}`).join(', ')
    if (field === 'tenants')
      return values.map((id) => tenantOptions?.find((o) => o.value === id)?.label ?? id).join(', ')
    return values.join(', ')
  }

  const removeMulti =
    (field: 'collections' | 'globals' | 'operations' | 'tenants' | 'userIds') => (e: React.MouseEvent) => {
      e.stopPropagation()
      setStaged((f) => {
        const next = { ...f, [field]: undefined }
        if (field === 'operations') delete next.eventType
        if (field === 'userIds') delete next.userCollection
        return next
      })
    }

  const removeScalar = (field: 'documentId' | 'eventType' | 'group') => (e: React.MouseEvent) => {
    e.stopPropagation()
    setStaged((f) => {
      const next = { ...f }
      delete next[field]
      return next
    })
  }

  const removeDateRange = (e: React.MouseEvent) => {
    e.stopPropagation()
    setStaged((f) => {
      const next = { ...f }
      delete next.dateFrom
      delete next.dateTo
      return next
    })
  }

  const removeChangedPath = (index: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    setStaged((f) => {
      const paths = [...(f.changedPaths ?? [])]
      paths.splice(index, 1)
      return { ...f, changedPaths: paths.length ? paths : undefined }
    })
  }

  const handleApply = useCallback(() => onFilter(staged), [onFilter, staged])

  const handleClear = useCallback(() => {
    setStaged({})
    onFilter({})
  }, [onFilter])

  const datePillValue = (() => {
    if (staged.dateFrom && staged.dateTo)
      return `${formatDatePill(staged.dateFrom)} – ${formatDatePill(staged.dateTo)}`
    if (staged.dateFrom) return `from ${formatDatePill(staged.dateFrom)}`
    if (staged.dateTo) return `until ${formatDatePill(staged.dateTo)}`
    return ''
  })()

  return (
    <div className="al-filterbar">
      <div className="al-filterbar__row">
        {/* Multi-select pills (collections, globals, operations, tenants, userIds) */}
        {(['collections', 'globals', 'operations', 'tenants', 'userIds'] as const).map((field) => {
          const values = staged[field] ?? []
          if (!values.length) return null
          const label =
            field === 'collections' ? t('auditPlugin:filterCollection')
            : field === 'globals' ? t('auditPlugin:filterGlobal')
            : field === 'operations' ? t('auditPlugin:filterOperation')
            : field === 'tenants' ? t('auditPlugin:filterTenant')
            : t('auditPlugin:filterUser')
          return (
            <Popup
              key={field}
              button={
                <button className="al-filterpill" type="button">
                  <span className="al-filterpill__label">{label}</span>
                  <span className="al-filterpill__sep">:</span>
                  <span className="al-filterpill__value">{getMultiPillValue(field)}</span>
                  <span
                    className="al-filterpill__remove"
                    onClick={removeMulti(field)}
                    role="button"
                    tabIndex={-1}
                  >
                    ×
                  </span>
                </button>
              }
              buttonType="custom"
              caret={false}
              horizontalAlign="left"
              portalClassName="al-filter-popup"
              render={({ close }) => (
                <ValueEditor
                  collectionSlugs={collectionSlugs}
                  field={field === 'userIds' ? 'userId' : field === 'tenants' ? 'tenant' : field}
                  globalSlugs={globalSlugs}
                  onClose={close}
                  setStaged={setStaged}
                  staged={staged}
                  tenantOptions={tenantOptions}
                  userTitleFields={userTitleFields}
                />
              )}
              size="fit-content"
            />
          )
        })}

        {/* Single value pills (documentId, eventType, group) */}
        {(['documentId', 'eventType', 'group'] as const).map((field) => {
          const val = staged[field]
          if (!val) return null
          const label =
            field === 'documentId' ? t('auditPlugin:filterDocument')
            : field === 'eventType' ? t('auditPlugin:filterEventType')
            : t('auditPlugin:filterGroup')
          const displayVal = field === 'documentId' ? `#${val.slice(-8)}` : val
          return (
            <Popup
              key={field}
              button={
                <button className="al-filterpill" type="button">
                  <span className="al-filterpill__label">{label}</span>
                  <span className="al-filterpill__sep">:</span>
                  <span className="al-filterpill__value">{displayVal}</span>
                  <span
                    className="al-filterpill__remove"
                    onClick={removeScalar(field)}
                    role="button"
                    tabIndex={-1}
                  >
                    ×
                  </span>
                </button>
              }
              buttonType="custom"
              caret={false}
              horizontalAlign="left"
              portalClassName="al-filter-popup"
              render={({ close }) => (
                <ValueEditor
                  collectionSlugs={collectionSlugs}
                  field={field}
                  globalSlugs={globalSlugs}
                  onClose={close}
                  setStaged={setStaged}
                  staged={staged}
                  userTitleFields={userTitleFields}
                />
              )}
              size="fit-content"
            />
          )
        })}

        {/* Changed path pills */}
        {(staged.changedPaths ?? []).map((path, i) => (
          <Popup
            key={`cp-${i}`}
            button={
              <button className="al-filterpill" type="button">
                <span className="al-filterpill__label">{t('auditPlugin:filterChangedPath')}</span>
                <span className="al-filterpill__sep">:</span>
                <span className="al-filterpill__value">{path}</span>
                <span
                  className="al-filterpill__remove"
                  onClick={removeChangedPath(i)}
                  role="button"
                  tabIndex={-1}
                >
                  ×
                </span>
              </button>
            }
            buttonType="custom"
            caret={false}
            horizontalAlign="left"
            portalClassName="al-filter-popup"
            render={({ close }) => (
              <ValueEditor
                collectionSlugs={collectionSlugs}
                field="changedPath"
                globalSlugs={globalSlugs}
                index={i}
                onClose={close}
                setStaged={setStaged}
                staged={staged}
                userTitleFields={userTitleFields}
              />
            )}
            size="fit-content"
          />
        ))}

        {/* Date range pill */}
        {(staged.dateFrom || staged.dateTo) && (
          <Popup
            button={
              <button className="al-filterpill" type="button">
                <span className="al-filterpill__label">{t('auditPlugin:filterDate')}</span>
                <span className="al-filterpill__sep">:</span>
                <span className="al-filterpill__value">{datePillValue}</span>
                <span
                  className="al-filterpill__remove"
                  onClick={removeDateRange}
                  role="button"
                  tabIndex={-1}
                >
                  ×
                </span>
              </button>
            }
            buttonType="custom"
            caret={false}
            horizontalAlign="left"
            portalClassName="al-filter-popup"
            render={({ close }) => (
              <ValueEditor
                collectionSlugs={collectionSlugs}
                field="dateRange"
                globalSlugs={globalSlugs}
                onClose={close}
                setStaged={setStaged}
                staged={staged}
                userTitleFields={userTitleFields}
              />
            )}
            size="fit-content"
          />
        )}

        {/* Add filter button */}
        {availableToAdd.length > 0 && (
          <AddFilterPopup
            availableToAdd={availableToAdd}
            collectionSlugs={collectionSlugs}
            globalSlugs={globalSlugs}
            setStaged={setStaged}
            staged={staged}
            tenantOptions={tenantOptions}
            userTitleFields={userTitleFields}
          />
        )}

        <span className="al-filterbar__spacer" />

        {isDirty && (
          <Button onClick={handleApply} margin={false} buttonStyle="primary" size={'small'}>
            {t('auditPlugin:apply')}
          </Button>
        )}
        {hasActiveFilters && (
          <Button onClick={handleClear} margin={false} buttonStyle="pill" size={'small'}>
            {t('auditPlugin:clearAll')}
          </Button>
        )}
      </div>
    </div>
  )
}
