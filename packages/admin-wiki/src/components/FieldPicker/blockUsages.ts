import type { ClientBlock, ClientConfig, ClientField } from 'payload'
import { getFieldPaths, groupHasName, tabHasName } from 'payload/shared'

/** Where a block is rendered from, which is the only place its schema is keyed. */
export type WikiBlockUsage = {
	/** The block config that usage declares, which is what the picker renders. */
	block: ClientBlock
	entityKind: 'collection' | 'global'
	entitySlug: string
	/**
	 * Payload's schema path for the block at that usage, e.g.
	 * `posts.layout.heroBanner`. This is the key `buildFormState` resolves against
	 * the field schema map, and the `parentSchemaPath` `RenderFields` needs.
	 */
	schemaPath: string
}

type Covered = {
	collections: string[]
	globals: string[]
}

type Candidate = WikiBlockUsage & { fromRegistry: boolean }

type WalkContext = {
	blocksMap: Record<string, ClientBlock>
	entityKind: 'collection' | 'global'
	entitySlug: string
	found: Map<string, Candidate>
	visited: Set<ClientBlock>
}

/**
 * Record a usage, keeping the registry variant wherever one exists.
 *
 * A slug may be declared twice with different fields (Payload's duplicate check
 * runs per blocks field, not across the config), and the two declarations are
 * separate keys in the schema map. Only one schema can be rendered, and core
 * itself resolves such a slug registry-first in its own admin, so the picker
 * does the same; fields that exist only on the shadowed variant stay valid
 * targets and are reachable through the manual path input.
 */
const remember = (slug: string, candidate: Candidate, context: WalkContext): void => {
	const existing = context.found.get(slug)
	if (!existing || (candidate.fromRegistry && !existing.fromRegistry)) {
		context.found.set(slug, candidate)
	}
}

/**
 * Walk a field tree the way `buildFieldSchemaMap/traverseFields` does, so the
 * paths this produces are the paths the server keyed the schema map with.
 *
 * The index-path bookkeeping is the whole reason this cannot be the plugin's own
 * walker: unnamed rows, collapsibles, and unnamed tabs contribute `_index-N`
 * segments, and `getFieldPaths` is what turns a position into one. Named groups
 * and named tabs reset the index path; unnamed ones carry it down.
 */
const traverse = ({
	context,
	fields,
	parentIndexPath,
	parentSchemaPath,
}: {
	context: WalkContext
	fields: ClientField[]
	parentIndexPath: string
	parentSchemaPath: string
}): void => {
	fields.forEach((field, index) => {
		const { indexPath, schemaPath } = getFieldPaths({
			field,
			index,
			parentIndexPath,
			parentSchemaPath,
		})
		switch (field.type) {
			case 'array':
				traverse({
					context,
					fields: field.fields,
					parentIndexPath: '',
					parentSchemaPath: schemaPath,
				})
				break
			case 'blocks': {
				const declared = field.blockReferences ?? field.blocks ?? []
				for (const entry of declared) {
					const fromRegistry = typeof entry === 'string'
					const block = fromRegistry ? context.blocksMap[entry] : entry
					if (!block) {
						continue
					}
					const blockSchemaPath = `${schemaPath}.${block.slug}`
					remember(
						block.slug,
						{
							block,
							entityKind: context.entityKind,
							entitySlug: context.entitySlug,
							fromRegistry: fromRegistry || context.blocksMap[block.slug] === block,
							schemaPath: blockSchemaPath,
						},
						context
					)
					// Once per config object: a block reached from ten usages has one
					// interior, and this also terminates a block that allows itself.
					if (!context.visited.has(block)) {
						context.visited.add(block)
						traverse({
							context,
							fields: block.fields,
							parentIndexPath: '',
							parentSchemaPath: blockSchemaPath,
						})
					}
				}
				break
			}
			case 'collapsible':
			case 'row':
				traverse({
					context,
					fields: field.fields,
					parentIndexPath: indexPath,
					parentSchemaPath: schemaPath,
				})
				break
			case 'group':
				traverse({
					context,
					fields: field.fields,
					parentIndexPath: groupHasName(field) ? '' : indexPath,
					parentSchemaPath: schemaPath,
				})
				break
			case 'tabs':
				field.tabs.forEach((tab, tabIndex) => {
					const tabPaths = getFieldPaths({
						field: tab,
						index: tabIndex,
						parentIndexPath: indexPath,
						parentSchemaPath: schemaPath,
					})
					traverse({
						context,
						fields: tab.fields,
						parentIndexPath: tabHasName(tab) ? '' : tabPaths.indexPath,
						parentSchemaPath: tabPaths.schemaPath,
					})
				})
				break
			default:
				break
		}
	})
}

/**
 * One rendering usage per block slug, keyed by slug.
 *
 * A block's fields have no schema path of their own: the field schema map keys
 * them per usage, as `<blocks field's schema path>.<block slug>`, so building
 * form state for a block means naming a place it is actually rendered. Blocks
 * that are declared but used nowhere therefore have no entry here, and the
 * picker leaves them out of its grid rather than offering a form it cannot
 * build.
 *
 * Only covered entities are walked, so a block reachable only from an excluded
 * collection resolves to nothing, exactly as it is unreachable everywhere else
 * in the plugin.
 */
export const collectBlockUsages = (
	config: ClientConfig,
	covered: Covered
): Map<string, WikiBlockUsage> => {
	const found = new Map<string, Candidate>()
	const visited = new Set<ClientBlock>()
	const blocksMap = config.blocksMap ?? {}

	const walkEntity = (
		entityKind: 'collection' | 'global',
		entitySlug: string,
		fields: ClientField[] | undefined
	): void => {
		if (!fields) {
			return
		}
		traverse({
			context: { blocksMap, entityKind, entitySlug, found, visited },
			fields,
			parentIndexPath: '',
			parentSchemaPath: entitySlug,
		})
	}

	for (const slug of covered.collections) {
		walkEntity(
			'collection',
			slug,
			config.collections.find((collection) => collection.slug === slug)?.fields
		)
	}
	for (const slug of covered.globals) {
		walkEntity('global', slug, config.globals.find((global) => global.slug === slug)?.fields)
	}

	return new Map(
		[...found].map(([slug, { fromRegistry: _fromRegistry, ...usage }]) => [slug, usage])
	)
}
