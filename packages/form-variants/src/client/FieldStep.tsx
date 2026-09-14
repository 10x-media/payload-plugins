'use client'

import { RenderFields, useConfig, useDocumentInfo } from '@payloadcms/ui'
import type { ClientField } from 'payload'
import type React from 'react'
import { useMemo } from 'react'

import { BASE_CLASS } from '../plugin/constants'
import { buildFieldIndex } from './fieldIndex'
import { useRunnerInternals } from './Runner'
import type { ClientFieldItem, ClientStep } from './types'

/** The field with the step's label and description overrides applied. */
const withOverrides = (
	field: ClientField,
	item: Extract<ClientFieldItem, { type: 'field' }>
): ClientField => {
	if (item.label === undefined && item.description === undefined) {
		return field
	}
	return {
		...field,
		...(item.label !== undefined ? { label: item.label } : {}),
		...(item.description !== undefined
			? {
					admin: {
						...(field.admin as Record<string, unknown> | undefined),
						description: item.description,
					},
				}
			: {}),
	} as ClientField
}

/**
 * Renders a field step: each listed path through Payload's own `RenderFields`, addressed the
 * way the native form addresses it, so custom components, conditions and validation apply.
 * Fields stack in one column with the native form's spacing. A listed field absent from form
 * state for this account renders nothing.
 */
export const FieldStep: React.FC<{ readOnly: boolean; step: ClientStep }> = ({
	readOnly,
	step,
}) => {
	const { collectionSlug, docPermissions } = useDocumentInfo()
	const { getEntityConfig } = useConfig()
	const { rendered } = useRunnerInternals()
	const collectionConfig = getEntityConfig({ collectionSlug })

	const index = useMemo(
		() =>
			buildFieldIndex(collectionConfig?.fields ?? [], collectionSlug ?? '', docPermissions?.fields),
		[collectionConfig?.fields, collectionSlug, docPermissions?.fields]
	)

	return (
		<div className={`${BASE_CLASS}__fields`}>
			{step.items.map((item) => {
				if (item.type === 'component') {
					return (
						<div className={`${BASE_CLASS}__item`} key={item.id}>
							{rendered[item.id]}
						</div>
					)
				}
				const entry = index.get(item.path)
				if (!entry) {
					return null
				}
				return (
					<RenderFields
						fields={[withOverrides(entry.field, item)]}
						forceRender
						key={item.path}
						parentIndexPath={entry.parentIndexPath}
						parentPath={entry.parentPath}
						parentSchemaPath={entry.parentSchemaPath}
						permissions={entry.permissions ?? true}
						readOnly={readOnly}
					/>
				)
			})}
		</div>
	)
}
