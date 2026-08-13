/**
 * Target keys are the wire format between stored guide targets, the
 * targets-map endpoint, and every client trigger. This module must stay free
 * of server-only imports; the client bundle uses it.
 */

export type WikiTargetType = 'block' | 'collection' | 'field' | 'global'

/**
 * The four `string[]` fields a guide stores its attachments in, one per target
 * kind. Every value is a bare slug except `targetFields`, which stores an
 * owner-qualified schema path (`collection:posts.title`,
 * `block:heroBanner.heading`) because a collection and a global may share a
 * slug, and because a field inside a block belongs to the block.
 */
export type WikiTargetDoc = {
	targetBlocks?: null | string[]
	targetCollections?: null | string[]
	targetFields?: null | string[]
	targetGlobals?: null | string[]
}

/** The `select` shape every query that needs target keys must ask for. */
export const wikiTargetSelect = {
	targetBlocks: true,
	targetCollections: true,
	targetFields: true,
	targetGlobals: true,
} as const

/** A guide as listed in the targets map: enough for triggers and hover cards. */
export type WikiTargetEntry = {
	featured: boolean
	featuredOrder: null | number
	id: number | string
	slug: null | string
	summary: null | string
	/**
	 * Every target key this guide is attached to, for the chips that tell a
	 * reader which surfaces it covers. Omitted where the caller does not select
	 * the `targets` field.
	 */
	targetKeys?: string[]
	title: null | string
}

export type WikiTargetsResponse = {
	canCreate: boolean
	canUpdate: boolean
	/** The content locale guides were resolved in; null when not localized. */
	locale: null | string
	targets: Record<string, WikiTargetEntry[]>
}

/** A loaded guide document as the drawer and views consume it. */
export type WikiGuideDoc = {
	content?: unknown
	id: number | string
	slug?: null | string
	summary?: null | string
	title?: null | string
}

export const collectionTargetKey = (slug: string): string => `collection:${slug}`
export const globalTargetKey = (slug: string): string => `global:${slug}`
export const blockTargetKey = (slug: string): string => `block:${slug}`

/**
 * `schemaPath` is owner-qualified, as the walker emits it and as `targetFields`
 * stores it: `collection:posts.title`, `global:settings.name`,
 * `block:heroBanner.heading`.
 */
export const fieldTargetKey = (schemaPath: string): string => `field:${schemaPath}`

/** The stored field a target kind lives in, for prefill and mapping. */
export const targetFieldNameFor = (kind: WikiTargetType): keyof WikiTargetDoc => {
	switch (kind) {
		case 'block':
			return 'targetBlocks'
		case 'collection':
			return 'targetCollections'
		case 'field':
			return 'targetFields'
		case 'global':
			return 'targetGlobals'
	}
}

const keyBuilders: Array<[keyof WikiTargetDoc, (value: string) => string]> = [
	['targetCollections', collectionTargetKey],
	['targetGlobals', globalTargetKey],
	['targetFields', fieldTargetKey],
	['targetBlocks', blockTargetKey],
]

/** Every target key a guide document is attached to, deduplicated. */
export const targetKeysForDoc = (doc: unknown): string[] => {
	const source = (doc ?? {}) as WikiTargetDoc
	const keys = new Set<string>()
	for (const [field, toKey] of keyBuilders) {
		for (const value of source[field] ?? []) {
			if (typeof value === 'string' && value.length > 0) {
				keys.add(toKey(value))
			}
		}
	}
	return [...keys]
}

/** Sort guides for presentation: featured first (by order), then by title. */
export const compareTargetEntries = (a: WikiTargetEntry, b: WikiTargetEntry): number => {
	if (a.featured !== b.featured) {
		return a.featured ? -1 : 1
	}
	if (a.featured && b.featured) {
		const orderA = a.featuredOrder ?? Number.MAX_SAFE_INTEGER
		const orderB = b.featuredOrder ?? Number.MAX_SAFE_INTEGER
		if (orderA !== orderB) {
			return orderA - orderB
		}
	}
	return (a.title ?? '').localeCompare(b.title ?? '')
}
