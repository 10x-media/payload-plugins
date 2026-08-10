'use client'

import React, { useCallback, useState } from 'react'
import { Button, ReactSelect, useTranslation } from '@payloadcms/ui'

import type { CustomTranslationsKeys, CustomTranslationsObject } from '../../../../translations/index'

import type { EditorProps, SelectOption } from './types'
import { PayloadDocSelect } from './PayloadDocSelect'

type Props = EditorProps & {
  userTitleFields: Record<string, string>
}

export function UserFilterEditor({ onClose, setStaged, staged, userTitleFields }: Props) {
  const { t } = useTranslation<CustomTranslationsObject, CustomTranslationsKeys>()
  const authSlugs = Object.keys(userTitleFields)
  const [selectedCollection, setSelectedCollection] = useState<string>(
    staged.userCollection ?? (authSlugs.length === 1 ? (authSlugs[0] ?? '') : ''),
  )
  const [manualId, setManualId] = useState('')

  const activeCollection = selectedCollection || (authSlugs.length === 1 ? authSlugs[0] : undefined)
  const currentIds = staged.userIds ?? []

  const addId = useCallback(
    (id: string) => {
      if (currentIds.includes(id)) return
      setStaged((f) => ({
        ...f,
        userIds: [...(f.userIds ?? []), id],
        ...(authSlugs.length > 1 && activeCollection ? { userCollection: activeCollection } : {}),
      }))
    },
    [currentIds, activeCollection, authSlugs.length, setStaged],
  )

  const removeId = useCallback(
    (id: string) => {
      setStaged((f) => {
        const newIds = (f.userIds ?? []).filter((i) => i !== id)
        const next = { ...f, userIds: newIds.length ? newIds : undefined }
        if (!newIds.length) delete next.userCollection
        return next
      })
    },
    [setStaged],
  )

  const commitManual = useCallback(() => {
    if (manualId.trim()) {
      addId(manualId.trim())
      setManualId('')
    }
  }, [manualId, addId])

  const collectionOptions: SelectOption[] = authSlugs.map((s) => ({ label: s, value: s }))

  return (
    <div className="al-filterpopover__editor" data-popup-prevent-close>
      <div className="al-filterpopover__editor-label">{t('auditPlugin:filterUser')}</div>

      {currentIds.length > 0 && (
        <div className="al-filterpopover__tags">
          {currentIds.map((id) => (
            <span className="al-filterpopover__tag" key={id}>
              #{id.slice(-8)}
              <span
                className="al-filterpopover__tag-remove"
                onClick={() => removeId(id)}
                role="button"
                tabIndex={-1}
              >
                ×
              </span>
            </span>
          ))}
        </div>
      )}

      {authSlugs.length > 1 && (
        <ReactSelect
          onChange={(selected) => {
            const opt = selected as SelectOption | null
            setSelectedCollection(opt?.value ?? '')
          }}
          options={collectionOptions}
          placeholder={t('auditPlugin:selectCollectionPlaceholder')}
          value={collectionOptions.find((o) => o.value === selectedCollection) ?? undefined}
        />
      )}

      {activeCollection && (
        <PayloadDocSelect
          collection={activeCollection}
          onSelect={addId}
          titleField={userTitleFields[activeCollection] ?? 'id'}
        />
      )}

      <div className="al-filterpopover__divider">{t('auditPlugin:orEnterId')}</div>
      <div className="al-filterpopover__input-row">
        <div className="field-type text" style={{ flex: '1 1 auto' }}>
          <div className="field-type__wrap">
            <input
              autoFocus={authSlugs.length === 0}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitManual()
                if (e.key === 'Escape') onClose()
              }}
              placeholder={t('auditPlugin:userIdPlaceholder')}
              type="text"
              value={manualId}
            />
          </div>
        </div>
        <Button buttonStyle="primary" margin={false} onClick={commitManual}>
          {t('auditPlugin:add')}
        </Button>
      </div>

      {currentIds.length > 0 && (
        <div className="al-filterpopover__actions">
          <Button margin={false} onClick={onClose}>
            {t('auditPlugin:done')}
          </Button>
        </div>
      )}
    </div>
  )
}
