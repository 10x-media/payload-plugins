import type { Block, Field } from 'payload'
import { fieldAffectsData, tabHasName } from 'payload/shared'

export type FieldKind = 'rel-single' | 'rel-many' | 'join'

/**
 * A flat map from dot-notation field path → relationship kind.
 * Array item positions are represented with `*` wildcards, e.g. `steps.*.assignee`.
 * Built once per collection/global at plugin init time.
 */
export type FieldMap = Map<string, FieldKind>

const maps = new WeakMap<object, FieldMap>()

/**
 * The field map of a sanitized collection or global config, built on first use and kept for
 * as long as that config lives. Hooks pass the config they are handed, which carries every
 * field added after this plugin ran: Payload's own `createdBy` / `updatedBy` (added while it
 * sanitizes) and whatever plugins later in `config.plugins` add. A map built from the raw
 * config at plugin time misses those, and their populated values reach the log. Keyed by the
 * config object, so each Payload instance gets its own map and a reloaded config a new one.
 */
export const fieldMapOf = (entity: { fields: Field[] }, blocks: Block[] | undefined): FieldMap => {
	let map = maps.get(entity)
	if (!map) {
		map = buildFieldMap(entity.fields, { blocks })
		maps.set(entity, map)
	}
	return map
}

/**
 * Walks a Payload field config tree and records every relationship/upload field
 * with its kind ('rel-single' | 'rel-many').
 *
 * Path rules (mirrors Payload's own schema path construction):
 *  - Named group / named tab → adds a path segment
 *  - Unnamed group / unnamed tab / row / collapsible → fields inlined at same level
 *  - array / blocks → adds a path segment, then recurses under `fieldName.*` wildcard
 *
 * A blocks field may name a block by slug; `blocks` (the config's `blocks`)
 * resolves those. A slug it does not list is skipped.
 */
export function buildFieldMap(
	fields: Field[],
	{
		blocks: configBlocks = [],
		map = new Map(),
		prefix = '',
	}: { blocks?: Block[]; map?: FieldMap; prefix?: string } = {}
): FieldMap {
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
				// groupHasName from payload/shared is typed for client fields only, check inline instead
				if ('name' in field && fieldAffectsData(field)) {
					buildFieldMap(field.fields, {
						blocks: configBlocks,
						map,
						prefix: prefix ? `${prefix}.${field.name}` : field.name,
					})
				} else {
					buildFieldMap(field.fields, { blocks: configBlocks, map, prefix })
				}
				break

			case 'row':
			case 'collapsible':
				buildFieldMap(field.fields, { blocks: configBlocks, map, prefix })
				break

			case 'tabs':
				for (const tab of field.tabs) {
					buildFieldMap(tab.fields, {
						blocks: configBlocks,
						map,
						prefix: tabHasName(tab)
							? prefix
								? `${prefix}.${String(tab.name)}`
								: String(tab.name)
							: prefix,
					})
				}
				break

			case 'join':
				if (fieldAffectsData(field)) {
					const path = prefix ? `${prefix}.${field.name}` : field.name
					map.set(path, 'join')
				}
				break

			case 'array':
				buildFieldMap(field.fields, {
					blocks: configBlocks,
					map,
					prefix: prefix ? `${prefix}.${field.name}.*` : `${field.name}.*`,
				})
				break

			case 'blocks':
				for (const entry of field.blocks) {
					const block =
						typeof entry === 'string' ? configBlocks.find((b) => b.slug === entry) : entry
					if (!block) continue
					buildFieldMap(block.fields, {
						blocks: configBlocks,
						map,
						prefix: prefix ? `${prefix}.${field.name}.*` : `${field.name}.*`,
					})
				}
				break
		}
	}
	return map
}
