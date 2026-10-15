import { type CollectionConfig, type Field, flattenTopLevelFields } from 'payload'

import type { ViewFilter } from '../types'

/** URL-safe, so `f.<name>` needs no encoding and reads the same in the address bar. */
const FILTER_NAME = /^[A-Za-z0-9_-]+$/

/** Whether a dot-notation path names a field, walking through groups and named tabs. */
export const hasFieldPath = (fields: Field[], path: string): boolean => {
	const [head, ...rest] = path.split('.')
	const field = flattenTopLevelFields(fields).find((f) => 'name' in f && f.name === head)
	if (!field) return false
	if (rest.length === 0) return true
	return 'fields' in field && Array.isArray(field.fields)
		? hasFieldPath(field.fields as Field[], rest.join('.'))
		: false
}

/**
 * Refuses a filter that could never work: a duplicate or unusable name, or a `path` the
 * finished collection does not have. Thrown at config time, since a filter that silently
 * matches nothing reads as "no entries", which is the wrong conclusion to hand an auditor.
 */
export const validateViewFilters = (
	collection: CollectionConfig,
	filters: ViewFilter[] | undefined
): void => {
	const seen = new Set<string>()
	for (const filter of filters ?? []) {
		const where = `audit-logs: view.filters '${filter.name}'`
		if (!FILTER_NAME.test(filter.name)) {
			throw new Error(`${where}: the name may hold only letters, digits, '-' and '_'.`)
		}
		if (seen.has(filter.name)) throw new Error(`${where}: the name is used twice.`)
		seen.add(filter.name)
		if (!hasFieldPath(collection.fields, filter.path)) {
			throw new Error(
				`${where}: the audit-logs collection has no field '${filter.path}'. Add it with logs.override.`
			)
		}
	}
}
