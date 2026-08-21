import type { Field } from 'payload'
import { type EncryptedFieldMarker, getEncryptedMarker } from './types'

/**
 * Walks named containers (group, named tabs) and layout containers (row,
 * collapsible, unnamed tabs) collecting encrypted markers by dot path.
 * Fields inside arrays and blocks encrypt at runtime but are excluded here:
 * query rewrite and bulk utilities do not address per-row paths in v1.
 */
const walk = (fields: Field[] | undefined, prefix: string): Map<string, EncryptedFieldMarker> => {
	const found = new Map<string, EncryptedFieldMarker>()
	for (const field of fields ?? []) {
		if ('name' in field && typeof field.name === 'string') {
			const marker = getEncryptedMarker(field as { custom?: Record<string, unknown> })
			if (marker) {
				found.set(`${prefix}${field.name}`, marker)
				continue
			}
		}
		if (field.type === 'group' && 'name' in field && field.name) {
			for (const [path, marker] of walk(field.fields, `${prefix}${field.name}.`)) {
				found.set(path, marker)
			}
		} else if (field.type === 'row' || field.type === 'collapsible') {
			for (const [path, marker] of walk(field.fields, prefix)) {
				found.set(path, marker)
			}
		} else if (field.type === 'tabs') {
			for (const tab of field.tabs) {
				const tabPrefix = 'name' in tab && tab.name ? `${prefix}${tab.name}.` : prefix
				for (const [path, marker] of walk(tab.fields, tabPrefix)) {
					found.set(path, marker)
				}
			}
		}
	}
	return found
}

/**
 * Cached per field array. Sanitized configs are built once and their field
 * arrays live for the process, so the scan result cannot go stale; a WeakMap
 * keyed on the array lets a discarded config (every booted Payload in a test
 * run) be collected with it.
 */
const cache = new WeakMap<Field[], ReadonlyMap<string, EncryptedFieldMarker>>()

const EMPTY: ReadonlyMap<string, EncryptedFieldMarker> = new Map()

/** Encrypted markers by dot path for one schema's fields. */
export const scanEncryptedFields = (
	fields: Field[] | undefined
): ReadonlyMap<string, EncryptedFieldMarker> => {
	if (!fields) {
		return EMPTY
	}
	const hit = cache.get(fields)
	if (hit) {
		return hit
	}
	const scanned = walk(fields, '')
	cache.set(fields, scanned)
	return scanned
}

export const queryableOnly = (
	markers: ReadonlyMap<string, EncryptedFieldMarker>
): ReadonlyMap<string, EncryptedFieldMarker> => {
	const out = new Map<string, EncryptedFieldMarker>()
	for (const [path, marker] of markers) {
		if (marker.queryable && marker.bidxName) {
			out.set(path, marker)
		}
	}
	return out
}
