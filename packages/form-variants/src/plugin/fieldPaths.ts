import type { Field, Tab } from 'payload'
import { fieldAffectsData, tabHasName } from 'payload/shared'

import { tabAsGroup } from './namedTab'

/**
 * Every data path a step may list, mapped to the field it names.
 *
 * Unnamed containers (row, collapsible, unnamed tab or group) contribute no segment. A named
 * group or tab is addressable whole and field by field. An `array` or `blocks` field is a leaf:
 * rows exist only at runtime, so nothing below it has a path.
 */
export const collectDataPaths = (fields: Field[], prefix = ''): Map<string, Field> => {
	const out = new Map<string, Field>()

	const visitTabs = (tabs: Tab[], parentPrefix: string): void => {
		for (const tab of tabs) {
			if (tabHasName(tab)) {
				const path = `${parentPrefix}${tab.name}`
				out.set(path, tabAsGroup(tab) as unknown as Field)
				for (const [childPath, child] of collectDataPaths(tab.fields, `${path}.`)) {
					out.set(childPath, child)
				}
			} else {
				for (const [childPath, child] of collectDataPaths(tab.fields, parentPrefix)) {
					out.set(childPath, child)
				}
			}
		}
	}

	for (const field of fields) {
		if (field.type === 'tabs') {
			visitTabs(field.tabs, prefix)
			continue
		}

		if (fieldAffectsData(field)) {
			const path = `${prefix}${field.name}`
			out.set(path, field)
			if (field.type === 'group') {
				for (const [childPath, child] of collectDataPaths(field.fields, `${path}.`)) {
					out.set(childPath, child)
				}
			}
			continue
		}

		if ('fields' in field && Array.isArray(field.fields)) {
			for (const [childPath, child] of collectDataPaths(field.fields, prefix)) {
				out.set(childPath, child)
			}
		}
	}

	return out
}
