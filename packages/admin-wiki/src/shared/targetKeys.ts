/**
 * Target keys are the wire format between stored guide targets, the
 * targets-map endpoint, and every client trigger. This module must stay free
 * of server-only imports; the client bundle uses it.
 */

export type WikiTargetType = 'block' | 'collection' | 'field' | 'global'

export type WikiTargetRow = {
	blockSlug?: string | null
	collectionSlug?: string | null
	fieldPath?: string | null
	globalSlug?: string | null
	type?: WikiTargetType | null
}

/** A guide as listed in the targets map: enough for triggers and hover cards. */
export type WikiTargetEntry = {
	featured: boolean
	featuredOrder: null | number
	id: number | string
	slug: null | string
	summary: null | string
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
export const fieldTargetKey = (schemaPath: string): string => `field:${schemaPath}`
export const blockTargetKey = (slug: string): string => `block:${slug}`

/** Key for a stored target row, or null when the row is incomplete. */
export const targetKeyForRow = (row: WikiTargetRow): null | string => {
	switch (row.type) {
		case 'block':
			return row.blockSlug ? blockTargetKey(row.blockSlug) : null
		case 'collection':
			return row.collectionSlug ? collectionTargetKey(row.collectionSlug) : null
		case 'field':
			return row.fieldPath ? fieldTargetKey(row.fieldPath) : null
		case 'global':
			return row.globalSlug ? globalTargetKey(row.globalSlug) : null
		default:
			return null
	}
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
