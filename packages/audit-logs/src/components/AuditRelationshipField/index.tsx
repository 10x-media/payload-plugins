'use client'
import type { RelationshipFieldClientComponent, ValueWithRelation } from 'payload'

import {
  FieldDescription,
  FieldError,
  FieldLabel,
  RenderCustomComponent,
  useAuth,
  useConfig,
  useDocumentDrawer,
  useField,
  useLocale,
  withCondition,
} from '@payloadcms/ui'
import { mergeFieldStyles } from '@payloadcms/ui/shared'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import './index.scss'

const baseClass = 'audit-relationship-field'

const AuditRelationshipFieldComponent: RelationshipFieldClientComponent = (props) => {
  const {
    field: {
      admin: { className, description } = {},
      label,
      localized,
      relationTo: relationToProp,
      required,
    },
    path: pathFromProps,
  } = props

  const field = props.field
  const {
    customComponents: { Description, Error, Label } = {},
    path,
    showError,
    value,
  } = useField({ potentiallyStalePath: pathFromProps })

  const { config, getEntityConfig } = useConfig()
  const {
    routes: { api },
    serverURL,
  } = config
  const { permissions } = useAuth()
  const { code: locale } = useLocale()

  const isPolymorphic = Array.isArray(relationToProp) && relationToProp.length > 1

  const { docId, relationSlug } = useMemo(() => {
    if (!value) {
      return { docId: null, relationSlug: null }
    }
    if (isPolymorphic) {
      const v = value as ValueWithRelation
      return { docId: v.value, relationSlug: v.relationTo }
    }
    const slug = Array.isArray(relationToProp) ? relationToProp[0] : relationToProp
    return { docId: value as number | string, relationSlug: slug }
  }, [value, isPolymorphic, relationToProp])

  const hasReadPermission = Boolean(relationSlug && permissions?.collections?.[relationSlug]?.read)

  const [displayLabel, setDisplayLabel] = useState<null | string>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!docId || !relationSlug) {
      setDisplayLabel(null)
      return
    }

    const collection = getEntityConfig({ collectionSlug: relationSlug })
    const titleField = collection?.admin?.useAsTitle || 'id'

    if (titleField === 'id') {
      setDisplayLabel(String(docId))
      return
    }

    setIsLoading(true)

    const params = new URLSearchParams({ depth: '0' })
    if (locale) {
      params.set('locale', locale)
    }
    params.append(`select[${titleField}]`, 'true')

    const url = `${serverURL}${api}/${relationSlug}/${docId}?${params.toString()}`

    fetch(url, {
      credentials: 'include',
      headers: { 'Accept-Language': locale ?? 'en' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((doc) => {
        setDisplayLabel(doc ? String(doc[titleField] ?? docId) : String(docId))
      })
      .catch(() => {
        setDisplayLabel(String(docId))
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [docId, relationSlug, api, serverURL, locale, getEntityConfig])

  const defaultSlug = Array.isArray(relationToProp) ? relationToProp[0] : relationToProp

  const [DocumentDrawer, , { openDrawer }] = useDocumentDrawer({
    id: docId ? String(docId) : undefined,
    collectionSlug: relationSlug ?? defaultSlug ?? '',
  })

  const handleClick = useCallback(() => {
    openDrawer()
  }, [openDrawer])

  const canOpenDrawer = hasReadPermission && Boolean(docId) && Boolean(relationSlug)

  const style = useMemo(() => mergeFieldStyles(field), [field])

  return (
    <div
      className={['field-type', baseClass, className, showError && 'error']
        .filter(Boolean)
        .join(' ')}
      id={`field-${path?.replace(/\./g, '__')}`}
      style={style}
    >
      <RenderCustomComponent
        CustomComponent={Label}
        Fallback={
          <FieldLabel label={label} localized={localized} path={path} required={required} />
        }
      />
      <div className={`${baseClass}__wrap`}>
        <RenderCustomComponent
          CustomComponent={Error}
          Fallback={<FieldError path={path} showError={showError} />}
        />
        <div className={`${baseClass}__value`}>
          {!value ? (
            <span className={`${baseClass}__empty`}>—</span>
          ) : isLoading ? (
            <span className={`${baseClass}__loading`}>&hellip;</span>
          ) : canOpenDrawer ? (
            <button className={`${baseClass}__link`} onClick={handleClick} type="button">
              {displayLabel ?? String(docId)}
            </button>
          ) : (
            <span className={`${baseClass}__text`}>{displayLabel ?? String(docId)}</span>
          )}
        </div>
        <RenderCustomComponent
          CustomComponent={Description}
          Fallback={<FieldDescription description={description} path={path} />}
        />
      </div>
      {canOpenDrawer && <DocumentDrawer />}
    </div>
  )
}

export const AuditRelationshipField = withCondition(AuditRelationshipFieldComponent)
