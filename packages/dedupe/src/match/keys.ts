import { createHash } from 'node:crypto'

import { fieldValues, type ResolvedMatchField } from './score'

/** Longer keys are hashed, which keeps them equal between identical texts and under any index limit. */
const MAX_KEY_LENGTH = 120

/**
 * Every key a document is filed under. Two documents are compared only when they share
 * one, so each field contributes several: the preset decides which, the path prefix keeps
 * an email from colliding with a name that happens to normalize the same, and the tenant
 * prefix keeps two tenants' documents out of each other's buckets altogether.
 */
export const blockingKeys = (
	doc: Record<string, unknown>,
	fields: readonly ResolvedMatchField[],
	tenant: string | null = null
): string[] => {
	const prefix = tenant === null ? '' : `t:${tenant}|`
	const keys = new Set<string>()
	for (const field of fields) {
		if (field.key === false) continue
		for (const value of fieldValues(doc, field.path, field.localized)) {
			for (const key of field.compare.keys(value)) {
				// A database index takes a few kilobytes at most; a long text is keyed by its hash.
				const kept =
					key.length > MAX_KEY_LENGTH ? `#${createHash('sha1').update(key).digest('hex')}` : key
				keys.add(`${prefix}${field.path}=${kept}`)
			}
		}
	}
	return [...keys]
}

/** Two document ids in the order a pair stores them, whichever way round they came. */
export const sortedPair = (left: number | string, right: number | string): [string, string] =>
	[String(left), String(right)].sort() as [string, string]

/**
 * One row per pair, whichever way round two documents are compared. The collection is part
 * of it: on Postgres every table counts its ids from 1, so two collections share id pairs.
 */
export const pairKeyFor = (
	collection: string,
	left: number | string,
	right: number | string
): string => [collection, ...sortedPair(left, right)].join(':')
