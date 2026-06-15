// biome-ignore-all lint/suspicious/noExplicitAny: todo - handle every any in this file
'use client'

import { BulkUploadProvider, useConfig, useField, withCondition } from '@payloadcms/ui'
import type { UploadFieldClientProps, ValueWithRelation } from 'payload'
import React, { useMemo } from 'react'

import { FolderPickerInput } from './Input'
import './index.scss'

function FolderPickerComponent(props: UploadFieldClientProps) {
	const {
		field,
		field: {
			admin: { allowCreate, className, description, isSortable } = {},
			hasMany,
			label,
			localized,
			maxRows,
			relationTo,
			required,
		},
		path: pathFromProps,
		readOnly,
		validate,
	} = props

	const { config } = useConfig()

	const displayPreview = field.displayPreview
	const folderEnabledRelations =
		(field.admin?.custom?.folderEnabledRelations as string[]) ??
		(Array.isArray(relationTo) ? relationTo : [relationTo as string])

	const memoizedValidate = React.useCallback(
		(value: any, options: any): string | true | Promise<string | true> => {
			if (typeof validate === 'function') {
				return validate(value, { ...options, required }) ?? true
			}
			return true
		},
		[validate, required]
	)

	const {
		customComponents: { AfterInput, BeforeInput, Description, Error: ErrorComponent, Label } = {},
		disabled,
		filterOptions,
		path,
		setValue,
		showError,
		value,
	} = useField<string | string[]>({
		potentiallyStalePath: pathFromProps,
		validate: memoizedValidate,
	})

	const isPolymorphic = Array.isArray(relationTo)

	const memoizedValue:
		| (number | string)[]
		| number
		| string
		| ValueWithRelation
		| ValueWithRelation[] = React.useMemo(() => {
		if (hasMany === true) {
			return (
				Array.isArray(value)
					? value.map((val) => {
							return isPolymorphic
								? val
								: {
										relationTo: Array.isArray(relationTo) ? relationTo[0] : relationTo,
										value: val,
									}
						})
					: value
			) as ValueWithRelation[]
		}
		return value
	}, [hasMany, value, isPolymorphic, relationTo])

	const styles = useMemo(
		() => ({
			...(field?.admin?.style || {}),
			...(field?.admin?.width ? { '--field-width': field.admin.width } : { flex: '1 1 auto' }),
			...(field?.admin?.style?.flex ? { flex: field.admin.style.flex } : {}),
		}),
		[field]
	)

	return (
		<BulkUploadProvider drawerSlugPrefix={pathFromProps}>
			<FolderPickerInput
				AfterInput={AfterInput}
				allowCreate={allowCreate !== false}
				api={config.routes.api}
				BeforeInput={BeforeInput}
				className={className}
				Description={Description}
				description={description}
				displayPreview={displayPreview}
				Error={ErrorComponent}
				filterOptions={filterOptions}
				folderEnabledRelations={folderEnabledRelations}
				hasMany={hasMany}
				isSortable={isSortable}
				label={label}
				Label={Label}
				localized={localized}
				maxRows={maxRows}
				onChange={setValue}
				path={path}
				readOnly={readOnly || disabled}
				relationTo={relationTo}
				required={required}
				serverURL={config.serverURL}
				showError={showError}
				style={styles}
				value={memoizedValue}
			/>
		</BulkUploadProvider>
	)
}

export const FolderPickerField = withCondition(FolderPickerComponent)
