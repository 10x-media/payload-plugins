import type { ClientField, Data } from 'payload'
import { groupHasName, tabHasName } from 'payload/shared'

/**
 * The data a picker form is seeded with so that every array opens with exactly
 * one empty row.
 *
 * An array with no rows renders as an empty list, and an empty list has no
 * subfields to click, so a guide could never be attached to anything inside one.
 * Payload builds row state from whatever rows the `data` argument carries
 * (`addFieldStatePromise` generates the row ids and recurses into the row's
 * fields with the same `renderAllFields`), so one `[{}]` per array is all it
 * takes; `calculateDefaultValues` then fills the row's own defaults.
 *
 * The recursion mirrors the walker's, minus the naming: only structure matters
 * here. Named groups and named tabs nest an object, and only when something
 * below them actually needs one, since Payload creates those itself for the
 * levels it reaches. Rows, collapsibles, and their unnamed counterparts merge
 * into the current level. Blocks are skipped: a block's rows have no schema
 * until one is chosen, and block interiors are their own picker entity.
 *
 * Returns `undefined` when the subtree contains no array at any depth, so
 * callers pass nothing rather than an empty object.
 */
export const buildPrefillData = (fields: ClientField[]): Data | undefined => {
	let data: undefined | Data

	const set = (name: string, value: unknown): void => {
		data = { ...(data ?? {}), [name]: value }
	}

	const mergeUp = (nested: Data | undefined): void => {
		if (nested) {
			data = { ...(data ?? {}), ...nested }
		}
	}

	for (const field of fields) {
		switch (field.type) {
			case 'array':
				set(field.name, [buildPrefillData(field.fields) ?? {}])
				break
			case 'collapsible':
			case 'row':
				mergeUp(buildPrefillData(field.fields))
				break
			case 'group': {
				const nested = buildPrefillData(field.fields)
				if (!nested) {
					break
				}
				if (groupHasName(field)) {
					set(field.name, nested)
				} else {
					mergeUp(nested)
				}
				break
			}
			case 'tabs':
				for (const tab of field.tabs) {
					const nested = buildPrefillData(tab.fields)
					if (!nested) {
						continue
					}
					if (tabHasName(tab)) {
						set(tab.name, nested)
					} else {
						mergeUp(nested)
					}
				}
				break
			default:
				break
		}
	}

	return data
}
