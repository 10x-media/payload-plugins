import type { Field } from 'payload'
import { fieldAffectsData, tabHasName } from 'payload/shared'

export type FieldKind = 'rel-single' | 'rel-many' | 'join'

/**
 * A flat map from dot-notation field path → relationship kind.
 * Array item positions are represented with `*` wildcards, e.g. `steps.*.assignee`.
 * Built once per collection/global at plugin init time.
 */
export type FieldMap = Map<string, FieldKind>

/**
 * Walks a Payload field config tree and records every relationship/upload field
 * with its kind ('rel-single' | 'rel-many').
 *
 * Path rules (mirrors Payload's own schema path construction):
 *  - Named group / named tab → adds a path segment
 *  - Unnamed group / unnamed tab / row / collapsible → fields inlined at same level
 *  - array / blocks → adds a path segment, then recurses under `fieldName.*` wildcard
 */
export function buildFieldMap(fields: Field[], prefix = '', map: FieldMap = new Map()): FieldMap {
	for (const field of fields) {
		switch (field.type) {
			case 'relationship':
			case 'upload':
				if (fieldAffectsData(field)) {
					const path = prefix ? `${prefix}.${field.name}` : field.name
					map.set(path, field.hasMany ? 'rel-many' : 'rel-single')
				}
				break

			case 'group':
				// groupHasName from payload/shared is typed for client fields only — check inline instead
				if ('name' in field && fieldAffectsData(field)) {
					buildFieldMap(field.fields, prefix ? `${prefix}.${field.name}` : field.name, map)
				} else {
					buildFieldMap(field.fields, prefix, map)
				}
				break

			case 'row':
			case 'collapsible':
				buildFieldMap(field.fields, prefix, map)
				break

			case 'tabs':
				for (const tab of field.tabs) {
					buildFieldMap(
						tab.fields,
						tabHasName(tab)
							? prefix
								? `${prefix}.${String(tab.name)}`
								: String(tab.name)
							: prefix,
						map
					)
				}
				break

			case 'join':
				if (fieldAffectsData(field)) {
					const path = prefix ? `${prefix}.${field.name}` : field.name
					map.set(path, 'join')
				}
				break

			case 'array':
				buildFieldMap(field.fields, prefix ? `${prefix}.${field.name}.*` : `${field.name}.*`, map)
				break

			case 'blocks':
				for (const block of field.blocks) {
					buildFieldMap(block.fields, prefix ? `${prefix}.${field.name}.*` : `${field.name}.*`, map)
				}
				break
		}
	}
	return map
}
