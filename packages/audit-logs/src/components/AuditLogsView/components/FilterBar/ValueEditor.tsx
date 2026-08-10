'use client'

import React from 'react'
import { useTranslation } from '@payloadcms/ui'

import type { Filters, SelectOption } from '../../types'
import type { FilterField } from './types'
import { OPERATION_OPTIONS } from './constants'
import { DateRangeEditor } from './DateRangeEditor'
import { MultiSelectEditor } from './MultiSelectEditor'
import { SingleValueEditor } from './SingleValueEditor'
import { UserFilterEditor } from './UserFilterEditor'
import type { CustomTranslationsKeys, CustomTranslationsObject } from '../../../../translations/index'

type Props = {
  collectionSlugs: string[]
  field: FilterField
  globalSlugs: string[]
  index?: number
  onClose: () => void
  setStaged: React.Dispatch<React.SetStateAction<Filters>>
  staged: Filters
  tenantOptions?: SelectOption[]
  userTitleFields: Record<string, string>
}

export function ValueEditor({ collectionSlugs, field, globalSlugs, index, onClose, setStaged, staged, tenantOptions, userTitleFields }: Props) {
  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()

  if (field === 'collections') {
    return (
      <MultiSelectEditor
        field="collections"
        label={t('auditPlugin:filterCollection')}
        onClose={onClose}
        options={collectionSlugs.map((s) => ({ label: s, value: s }))}
        setStaged={setStaged}
        staged={staged}
      />
    )
  }

  if (field === 'globals') {
    return (
      <MultiSelectEditor
        field="globals"
        label={t('auditPlugin:filterGlobal')}
        onClose={onClose}
        options={globalSlugs.map((s) => ({ label: s, value: s }))}
        setStaged={setStaged}
        staged={staged}
      />
    )
  }

  if (field === 'operations') {
    return (
      <MultiSelectEditor
        field="operations"
        label={t('auditPlugin:filterOperation')}
        onClose={onClose}
        options={OPERATION_OPTIONS}
        setStaged={setStaged}
        staged={staged}
      />
    )
  }

  if (field === 'tenant') {
    return (
      <MultiSelectEditor
        field="tenants"
        label={t('auditPlugin:filterTenant')}
        onClose={onClose}
        options={tenantOptions ?? []}
        setStaged={setStaged}
        staged={staged}
      />
    )
  }

  if (field === 'userId') {
    return (
      <UserFilterEditor
        onClose={onClose}
        setStaged={setStaged}
        staged={staged}
        userTitleFields={userTitleFields}
      />
    )
  }

  if (field === 'dateRange') {
    return <DateRangeEditor onClose={onClose} setStaged={setStaged} staged={staged} />
  }

  return (
    <SingleValueEditor
      field={field as 'changedPath' | 'documentId' | 'eventType' | 'group'}
      index={index}
      onClose={onClose}
      setStaged={setStaged}
      staged={staged}
      userTitleFields={userTitleFields}
    />
  )
}
