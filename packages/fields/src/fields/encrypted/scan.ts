import type { Field } from 'payload'
import { type EncryptedFieldMarker, getEncryptedMarker } from './types'

/**
 * Walks named containers (group, named tabs) and layout containers (row,
 * collapsible, unnamed tabs) collecting encrypted markers by dot path.
 * Fields inside arrays and blocks encrypt at runtime but are excluded here:
 * query rewrite and bulk utilities do not address per-row paths in v1.
 */
export const scanEncryptedFields = (
	fields: Field[] | undefined,
	prefix = ''
): Map<string, EncryptedFieldMarker> => {
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
			for (const [path, marker] of scanEncryptedFields(field.fields, `${prefix}${field.name}.`)) {
				found.set(path, marker)
			}
		} else if (field.type === 'row' || field.type === 'collapsible') {
			for (const [path, marker] of scanEncryptedFields(field.fields, prefix)) {
				found.set(path, marker)
			}
		} else if (field.type === 'tabs') {
			for (const tab of field.tabs) {
				const tabPrefix = 'name' in tab && tab.name ? `${prefix}${tab.name}.` : prefix
				for (const [path, marker] of scanEncryptedFields(tab.fields, tabPrefix)) {
					found.set(path, marker)
				}
			}
		}
	}
	return found
}

export const queryableOnly = (
	markers: Map<string, EncryptedFieldMarker>
): Map<string, EncryptedFieldMarker> => {
	const out = new Map<string, EncryptedFieldMarker>()
	for (const [path, marker] of markers) {
		if (marker.queryable && marker.bidxName) {
			out.set(path, marker)
		}
	}
	return out
}
