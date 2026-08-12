import type { ClientBlock, ClientField } from 'payload'

export type BlocksMap = Record<string, ClientBlock>

/**
 * One block from the client config's registry, by slug.
 *
 * A host that generated its types keys `config.blocksMap` by a union of its own
 * block slugs, which no stored target can be narrowed to, so every read of it
 * goes through the same widened view. Returns undefined for a slug the registry
 * does not hold, which is the normal case for a block declared inline.
 */
export const registryBlock = (blocksMap: BlocksMap, slug: string): ClientBlock | undefined =>
	blocksMap[slug]

const remember = (
	block: ClientBlock | undefined,
	found: Map<string, ClientBlock>,
	blocksMap: BlocksMap
): void => {
	if (!block || found.has(block.slug)) {
		return
	}
	found.set(block.slug, block)
	collectClientBlocks(block.fields, found, blocksMap)
}

/**
 * Every block reachable from a field tree, keyed by slug.
 *
 * The client config's own `blocksMap` only holds the shared definitions from
 * `config.blocks`; a block declared inline on a `blocks` field appears nowhere
 * but inside that field, so the tree has to be walked to find it. Nested blocks
 * are collected on the way through, which is what makes a block inside another
 * block's fields targetable.
 */
export const collectClientBlocks = (
	fields: ClientField[],
	found: Map<string, ClientBlock>,
	blocksMap: BlocksMap
): void => {
	for (const field of fields) {
		switch (field.type) {
			case 'blocks':
				for (const block of field.blocks ?? []) {
					remember(block, found, blocksMap)
				}
				for (const reference of field.blockReferences ?? []) {
					remember(
						typeof reference === 'string' ? blocksMap[reference] : reference,
						found,
						blocksMap
					)
				}
				break
			case 'array':
			case 'collapsible':
			case 'group':
			case 'row':
				collectClientBlocks(field.fields, found, blocksMap)
				break
			case 'tabs':
				for (const tab of field.tabs) {
					collectClientBlocks(tab.fields, found, blocksMap)
				}
				break
			default:
				break
		}
	}
}

/**
 * Resolve a client label that may be a plain string or a record keyed by
 * language, without depending on `@payloadcms/translations`. Mirrors its
 * `getTranslation` closely enough for block labels: exact language, then the
 * base of a regional code, then the first value declared.
 */
export const resolveClientLabel = (label: unknown, language: string, fallback: string): string => {
	if (typeof label === 'string') {
		return label
	}
	if (label === null || typeof label !== 'object') {
		return fallback
	}
	const record = label as Record<string, string>
	const base = language.split('-')[0] ?? language
	return record[language] ?? record[base] ?? Object.values(record)[0] ?? fallback
}
