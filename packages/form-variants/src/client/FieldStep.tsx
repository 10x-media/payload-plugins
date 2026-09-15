'use client'

import { Collapsible, RenderFields, useConfig, useDocumentInfo } from '@payloadcms/ui'
import type { ClientField } from 'payload'
import type React from 'react'
import { useMemo } from 'react'

import { BASE_CLASS } from '../plugin/constants'
import { buildFieldIndex, type IndexedField } from './fieldIndex'
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

/** The width a row gives one of its entries. Only a field carries one. */
const widthOf = (item: ClientFieldItem): string | undefined =>
	item.type === 'field' ? item.admin?.width : undefined

/**
 * Renders a field step: each listed path through Payload's own `RenderFields`, addressed the
 * way the native form addresses it, so custom components, conditions and validation apply.
 * A listed field absent from form state for this account renders nothing.
 *
 * A step may draw rows, collapsibles and groups around its fields. Those are the step's own,
 * not the collection's: they carry no name and no path, so every field inside keeps the parent
 * paths it has on the native form and is still rendered one by one. That is what lets a step
 * lay out fields that sit far apart in the collection, and it is why the containers are drawn
 * here rather than handed to Payload's own container fields, which would push a schema path
 * segment of their own onto the fields inside.
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

	const renderField = (
		item: Extract<ClientFieldItem, { type: 'field' }>,
		entry: IndexedField,
		key: string
	): React.ReactNode => (
		<RenderFields
			fields={[withOverrides(entry.field, item)]}
			forceRender
			key={key}
			parentIndexPath={entry.parentIndexPath}
			parentPath={entry.parentPath}
			parentSchemaPath={entry.parentSchemaPath}
			permissions={entry.permissions ?? true}
			readOnly={readOnly}
		/>
	)

	const renderItems = (items: ClientFieldItem[], prefix: string): React.ReactNode[] =>
		items.flatMap<React.ReactNode>((item, i) => {
			const key = prefix === '' ? String(i) : `${prefix}.${i}`
			switch (item.type) {
				case 'collapsible':
					return [
						<Collapsible
							className={`${BASE_CLASS}__collapsible`}
							header={item.label}
							initCollapsed={item.initCollapsed}
							key={key}
						>
							<div className={`${BASE_CLASS}__fields`}>{renderItems(item.items, key)}</div>
						</Collapsible>,
					]
				case 'component':
					return [
						<div className={`${BASE_CLASS}__item`} key={key}>
							{rendered[item.id]}
						</div>,
					]
				case 'group':
					return [
						<div className={`${BASE_CLASS}__group`} key={key}>
							{item.label && <h3 className={`${BASE_CLASS}__group-title`}>{item.label}</h3>}
							{item.description && (
								<p className={`${BASE_CLASS}__group-description`}>{item.description}</p>
							)}
							<div className={`${BASE_CLASS}__fields`}>{renderItems(item.items, key)}</div>
						</div>,
					]
				case 'row':
					return [
						<div className={`${BASE_CLASS}__row`} key={key}>
							{item.items.map((entry, j) => {
								const width = widthOf(entry)
								return (
									<div
										className={`${BASE_CLASS}__row-item`}
										// biome-ignore lint/suspicious/noArrayIndexKey: entries are positional
										key={j}
										style={
											width
												? ({
														'--form-variants-item-basis': `calc(${width} - var(--form-variants-row-gap))`,
														'--form-variants-item-grow': 0,
													} as React.CSSProperties)
												: undefined
										}
									>
										{renderItems([entry], `${key}.${j}`)}
									</div>
								)
							})}
						</div>,
					]
				default: {
					const entry = index.get(item.path)
					return entry ? [renderField(item, entry, key)] : []
				}
			}
		})

	return <div className={`${BASE_CLASS}__fields`}>{renderItems(step.items, '')}</div>
}
