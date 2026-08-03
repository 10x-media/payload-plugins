import type { ColorPreset } from '../../types'
import { PRESET_PREFIX } from './options'
import { readPath } from './paths'

export type PresetsFromArrayArgs = {
	/** The fetched doc holding the array. */
	doc: Record<string, unknown>
	/** Row field holding the stable key. */
	key: string
	/** Prepended to every preset key, e.g. `${tenant.slug}/` to namespace per doc. */
	keyPrefix?: string
	/** Row field holding the label. Falls back to the unprefixed key. */
	label?: string
	/** Dot path to the array field. Reaches into groups and named tabs. */
	path: string
	/** Row field holding the value, or the pair of row fields holding light and dark. */
	value: string | { light: string; dark: string }
}

const rowString = (row: Record<string, unknown>, field: string): null | string => {
	const value = row[field]
	if (typeof value !== 'string' || value === '' || value.startsWith(PRESET_PREFIX)) return null
	return value
}

/**
 * Lifts an array field's rows into linked-mode presets, which is how a
 * repeatable brand palette is authored. Unlike `presetsFromDoc` it needs no
 * `req` or `collection`: keys and labels come from row data rather than field
 * config, so there is nothing to look up or localize.
 *
 * Rows are skipped when the key is missing, non-string or empty, when the value
 * fields yield nothing usable, and when a value already carries `PRESET_PREFIX`.
 * A scheme pair with one member present becomes that color in both schemes,
 * matching how every other layer treats a half-filled value. On duplicate keys
 * the first row wins, so callers generating keys must keep them unique.
 */
export const presetsFromArray = (args: PresetsFromArrayArgs): ColorPreset[] => {
	const { doc, key, keyPrefix = '', label, path, value } = args
	const rows = readPath(doc, path)
	if (!Array.isArray(rows)) return []

	const presets: ColorPreset[] = []
	const seen = new Set<string>()

	for (const entry of rows) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
		const row = entry as Record<string, unknown>

		const rawKey = row[key]
		if (typeof rawKey !== 'string' || rawKey === '') continue
		const presetKey = `${keyPrefix}${rawKey}`
		if (seen.has(presetKey)) continue

		let presetValue: undefined | string | { dark: string; light: string }
		if (typeof value === 'string') {
			presetValue = rowString(row, value) ?? undefined
		} else {
			const light = rowString(row, value.light)
			const dark = rowString(row, value.dark)
			if (light || dark) {
				presetValue = { dark: dark ?? (light as string), light: light ?? (dark as string) }
			}
		}
		if (presetValue === undefined) continue

		seen.add(presetKey)
		const rowLabel = label === undefined ? undefined : row[label]
		presets.push({
			key: presetKey,
			label: typeof rowLabel === 'string' && rowLabel !== '' ? rowLabel : rawKey,
			value: presetValue,
		})
	}

	return presets
}
