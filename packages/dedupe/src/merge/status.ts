import { hasLocalizeStatusEnabled } from 'payload/shared'

import type { CollectionContext } from '../plugin/context'

type Status = 'draft' | 'published'

/**
 * Whether the collection publishes each locale on its own: Payload 4 turns `localizeStatus` on
 * for every collection with drafts and a localized field once the config is localized, and
 * `_status` then holds one status per locale.
 */
export const statusPerLocale = (col: Pick<CollectionContext, 'config' | 'hasDrafts'>): boolean =>
	col.hasDrafts && hasLocalizeStatusEnabled(col.config)

/**
 * A document's status in `locale`, as `_status` holds it read in every locale (an object by
 * locale) or in one (a string). Without a locale, a status per locale answers for the first.
 */
export const statusIn = (doc: Record<string, unknown>, locale?: string | null): Status | null => {
	const status = doc._status
	if (status === 'draft' || status === 'published') return status
	if (status && typeof status === 'object') {
		const byLocale = status as Record<string, unknown>
		const one = locale ? byLocale[locale] : Object.values(byLocale)[0]
		return one === 'draft' || one === 'published' ? one : null
	}
	return null
}

/**
 * Published in some locale. Only an explicit draft is left out: a status cleared to nothing
 * counts as published, as in Payload's access examples; a status per locale needs one locale
 * that is not a draft.
 */
export const isPublished = (doc: Record<string, unknown>): boolean => {
	const status = doc._status
	if (status && typeof status === 'object') {
		const values = Object.values(status as Record<string, unknown>)
		return values.length === 0 || values.some((value) => value !== 'draft')
	}
	return status !== 'draft'
}

/**
 * The locales the survivor of a merge of the published state is a draft in, where the
 * collection publishes each locale on its own: the merge writes them as drafts, unchecked, and
 * leaves them unpublished, as it leaves the published ones published.
 *
 * Read in every locale, a locale missing from `_status` was never published: MongoDB stores it
 * as `draft`, Postgres and SQLite have no locale row for it and leave it out.
 */
export const draftLocales = (
	col: Pick<CollectionContext, 'config' | 'hasDrafts' | 'options'>,
	survivor: Record<string, unknown>,
	locales: readonly string[] | null
): string[] => {
	if (!locales || col.options.draft || !statusPerLocale(col)) return []
	const status = survivor._status
	if (status && typeof status === 'object') {
		return locales.filter((locale) => (status as Record<string, unknown>)[locale] !== 'published')
	}
	return locales.filter((locale) => statusIn(survivor, locale) === 'draft')
}
