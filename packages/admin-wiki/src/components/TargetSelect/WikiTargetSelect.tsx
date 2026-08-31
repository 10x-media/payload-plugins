'use client'

import { useConfig } from '@payloadcms/ui'
import type { OptionObject, TextFieldClientProps } from 'payload'
import { useMemo } from 'react'

import { TargetMultiSelect } from './TargetMultiSelect'

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
 * Labels come from the client config rather than the injected props: they are
 * already resolved per request there, so a collection labelled per locale reads
 * in the admin's language without this component translating anything itself.
 */
export const WikiTargetSelect = ({ entity, slugs, ...props }: WikiTargetSelectProps) => {
	const { config } = useConfig()

	const options = useMemo<OptionObject[]>(() => {
		const labels = new Map<string, OptionObject['label']>(
			entity === 'collection'
				? config.collections.map((collection) => [collection.slug, collection.labels.plural])
				: config.globals.map((global) => [global.slug, global.label])
		)
		return slugs.map((slug) => ({ label: labels.get(slug) ?? slug, value: slug }))
	}, [config, entity, slugs])

	return <TargetMultiSelect {...props} options={options} />
}
