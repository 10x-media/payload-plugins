'use client'

import { type ReactSelectOption, SelectInput, useConfig, useField } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientProps } from 'payload'
import { useCallback, useMemo } from 'react'

export type EntitySelectProps = {
	/** Injected client prop: which entity list the options are drawn from. */
	entity: 'collection' | 'global'
	/** Injected client prop: the slugs a lock may freeze, in display order. */
	slugs: string[]
} & TextFieldClientProps

/**
 * A multi-select over collections or globals, stored as raw slugs in a
 * `text` `hasMany` field. Labels come from the client config, already resolved
 * for the admin's language. A slug that has since left the config still shows,
 * under its own name, so it can be removed.
 */
export const EntitySelect = ({
	entity,
	slugs,
	field,
	path: pathFromProps,
	readOnly,
}: EntitySelectProps) => {
	const { config } = useConfig()
	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[]>({ potentiallyStalePath: pathFromProps })

	const options = useMemo<OptionObject[]>(() => {
		const labels = new Map<string, OptionObject['label']>(
			entity === 'collection'
				? config.collections.map((collection) => [collection.slug, collection.labels.plural])
				: config.globals.map((global) => [global.slug, global.label])
		)
		return slugs.map((slug) => ({ label: labels.get(slug) ?? slug, value: slug }))
	}, [config, entity, slugs])

	const onChange = useCallback(
		(selected: ReactSelectOption | ReactSelectOption[]) => {
			if (readOnly || disabled) {
				return
			}
			setValue(Array.isArray(selected) ? selected.map((option) => String(option.value)) : [])
		},
		[disabled, readOnly, setValue]
	)

	return (
		<SelectInput
			Description={Description}
			description={field?.admin?.description}
			Error={ErrorComponent}
			hasMany
			isSortable={false}
			Label={Label}
			label={field?.label}
			name={field.name}
			onChange={onChange}
			options={options}
			path={path}
			readOnly={readOnly || disabled}
			showError={showError}
			value={value ?? []}
		/>
	)
}
