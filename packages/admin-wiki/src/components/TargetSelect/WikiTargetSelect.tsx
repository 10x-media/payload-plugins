'use client'

import { type ReactSelectOption, SelectInput, useConfig, useField } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientProps } from 'payload'
import { useCallback, useMemo } from 'react'

/** Which entity list the options are drawn from. */
export type WikiTargetEntityKind = 'collection' | 'global'

export type WikiTargetSelectProps = {
	/** Injected client prop: which entity list the options are drawn from. */
	entity: WikiTargetEntityKind
	/**
	 * Injected client prop: the slugs the plugin covers, in display order and
	 * already free of everything the host excluded.
	 */
	slugs: string[]
} & TextFieldClientProps

/**
 * The collection and global target lists, as a multi-select over the entities
 * the plugin actually covers.
 *
 * The stored field stays `text` with `hasMany`, so values remain raw slugs and
 * a target whose entity has since left the config is still readable, still
 * listed by the orphan banner, and still removable here. `SelectInput` renders
 * such a value under its own slug, since no option matches it.
 *
 * Labels come from the client config rather than the injected props: they are
 * already resolved per request there, so a collection labelled per locale reads
 * in the admin's language without this component translating anything itself.
 */
export const WikiTargetSelect = ({
	entity,
	field,
	path: pathFromProps,
	readOnly,
	slugs,
}: WikiTargetSelectProps) => {
	const { config } = useConfig()

	const options = useMemo<OptionObject[]>(() => {
		const labels = new Map<string, OptionObject['label']>(
			entity === 'collection'
				? config.collections.map((collection) => [collection.slug, collection.labels.plural])
				: config.globals.map((global) => [global.slug, global.label])
		)
		return slugs.map((slug) => ({ label: labels.get(slug) ?? slug, value: slug }))
	}, [config, entity, slugs])

	const {
		customComponents: { Description, Error: ErrorComponent, Label } = {},
		disabled,
		path,
		setValue,
		showError,
		value,
	} = useField<string[]>({ potentiallyStalePath: pathFromProps })

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
