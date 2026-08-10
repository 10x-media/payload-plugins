import type { Block, Config, Field } from 'payload'

import {
	blockTargetKey,
	collectionTargetKey,
	fieldTargetKey,
	globalTargetKey,
} from '../shared/targetKeys'
import type { ResolvedWikiOptions } from './resolveOptions'

export type WalkResult = {
	/**
	 * Singular label per block slug, for chips that would otherwise show a raw
	 * slug. Only blocks declaring a plain-string label appear; a label keyed by
	 * locale cannot be resolved at config time, where there is no request.
	 */
	blockLabels: Record<string, string>
	/** Named fields that received the injected Description component. */
	injectedFieldCount: number
	/** Every target key that resolves against the walked config. */
	validTargetKeys: string[]
}

const DESCRIPTION_COMPONENT = '@10x-media/admin-wiki/client#WikiFieldDescription'
const BLOCK_HELP_COMPONENT = '@10x-media/admin-wiki/client#WikiBlockHelp'

/**
 * Name of the UI field carrying a block's guides. Namespaced because it lands
 * in host block schemas; a block already declaring it keeps its own.
 */
export const WIKI_BLOCK_HELP_FIELD = 'adminWikiBlockHelp'

type WalkContext = {
	blockLabels: Record<string, string>
	blocksBySlug: Map<string, Block>
	excludedBlocks: Set<string>
	helpedBlocks: Set<string>
	validKeys: Set<string>
	injected: { count: number }
}

/**
 * Skip fields that already carry a custom Description component (we never
 * replace consumer components) and function descriptions (not serializable
 * into client props); both cases are documented integration limitations.
 */
const injectDescription = (field: Field, schemaPath: string, context: WalkContext): void => {
	context.validKeys.add(fieldTargetKey(schemaPath))
	const admin = (field as { admin?: Record<string, unknown> }).admin
	const components = admin?.components as { Description?: unknown } | undefined
	if (components?.Description !== undefined) {
		return
	}
	if (typeof admin?.description === 'function') {
		return
	}
	const target = field as {
		admin?: { components?: Record<string, unknown>; description?: unknown }
	}
	target.admin = {
		...target.admin,
		components: {
			...target.admin?.components,
			Description: {
				clientProps: {
					description: target.admin?.description ?? null,
					schemaPath,
				},
				path: DESCRIPTION_COMPONENT,
			},
		},
	}
	context.injected.count += 1
}

/**
 * Give a block its guides as a UI field, appended after its own fields.
 *
 * Not the row label, which is where this used to live: `Block.admin.components`
 * offers only `Label` and `Block`, the second replaces the header and
 * collapsible wholesale, and the first is the one slot consumers reach for when
 * they want computed row labels. Losing that race meant a block silently had no
 * guides at all, and winning it would have put a popup trigger inside the
 * collapsible's own click target. A field competes with nobody.
 *
 * Appended rather than prepended because a block whose first field is `tabs`
 * puts the whole tab bar below anything above it, and a stray line hanging over
 * a tab bar reads as broken layout. The cost is that the guide sits at the
 * bottom, where it is less obvious.
 *
 * Shared block configs (`config.blocks` / `blockReferences`) are mutated once.
 */
const injectBlockHelp = (block: Block, context: WalkContext): void => {
	if (context.helpedBlocks.has(block.slug)) {
		return
	}
	context.helpedBlocks.add(block.slug)
	const singular = block.labels?.singular
	if (typeof singular === 'string') {
		context.blockLabels[block.slug] = singular
	}
	const taken = block.fields.some(
		(field) => 'name' in field && field.name === WIKI_BLOCK_HELP_FIELD
	)
	if (taken) {
		return
	}
	block.fields = [
		...block.fields,
		{
			name: WIKI_BLOCK_HELP_FIELD,
			type: 'ui',
			admin: {
				components: {
					Field: { clientProps: { blockSlug: block.slug }, path: BLOCK_HELP_COMPONENT },
				},
				disableListColumn: true,
			},
		},
	]
}

const blocksOfField = (
	field: { blockReferences?: unknown; blocks?: Block[] },
	context: WalkContext
): Block[] => {
	const references = Array.isArray(field.blockReferences) ? field.blockReferences : []
	const resolved = references
		.map((reference) =>
			typeof reference === 'string' ? context.blocksBySlug.get(reference) : (reference as Block)
		)
		.filter((block): block is Block => Boolean(block))
	return [...(field.blocks ?? []), ...resolved]
}

const walkFields = (fields: Field[], parentPath: string, context: WalkContext): void => {
	for (const field of fields) {
		switch (field.type) {
			case 'row':
			case 'collapsible':
				walkFields(field.fields, parentPath, context)
				break
			case 'tabs':
				for (const tab of field.tabs) {
					const named = 'name' in tab && typeof tab.name === 'string' && tab.name.length > 0
					walkFields(tab.fields, named ? `${parentPath}.${tab.name}` : parentPath, context)
				}
				break
			case 'group': {
				const named = 'name' in field && typeof field.name === 'string' && field.name.length > 0
				const path = named ? `${parentPath}.${field.name}` : parentPath
				if (named) {
					injectDescription(field, path, context)
				}
				walkFields(field.fields, path, context)
				break
			}
			case 'array': {
				const path = `${parentPath}.${field.name}`
				injectDescription(field, path, context)
				walkFields(field.fields, path, context)
				break
			}
			case 'blocks': {
				const path = `${parentPath}.${field.name}`
				injectDescription(field, path, context)
				for (const block of blocksOfField(field, context)) {
					if (context.excludedBlocks.has(block.slug)) {
						continue
					}
					context.validKeys.add(blockTargetKey(block.slug))
					injectBlockHelp(block, context)
					walkFields(block.fields, `${path}.${block.slug}`, context)
				}
				break
			}
			case 'ui':
				break
			default:
				if ('name' in field && typeof field.name === 'string' && field.name.length > 0) {
					injectDescription(field, `${parentPath}.${field.name}`, context)
				}
		}
	}
}

/**
 * Walk every collection and global the plugin covers, injecting the field-help
 * Description component on every named field and collecting the set of valid
 * target keys for orphan detection. One walk, two outputs.
 *
 * Excluded entities are skipped whole: no injection, and no target keys, which
 * is what keeps them out of the target pickers and out of every write
 * affordance. Blocks are excluded by their own list, since a block slug lives
 * in a namespace of its own; a block reachable only from an excluded collection
 * is never walked either, so it ends up unhelped without being named.
 *
 * Schema paths are rooted at `collection:<slug>` or `global:<slug>` rather than
 * the bare slug: Payload only enforces slug uniqueness within collections
 * (`DuplicateCollection` in its config sanitizer), so a collection and a global
 * may share one, and an unqualified path would silently merge their fields.
 */
export const walkAndInjectFieldHelp = (
	config: Config,
	resolved: ResolvedWikiOptions
): WalkResult => {
	const context: WalkContext = {
		blockLabels: {},
		blocksBySlug: new Map((config.blocks ?? []).map((block) => [block.slug, block])),
		excludedBlocks: new Set(resolved.exclude.blocks),
		injected: { count: 0 },
		helpedBlocks: new Set<string>(),
		validKeys: new Set<string>(),
	}
	const excludedCollections = new Set(resolved.exclude.collections)
	const excludedGlobals = new Set(resolved.exclude.globals)
	for (const block of config.blocks ?? []) {
		if (context.excludedBlocks.has(block.slug)) {
			continue
		}
		context.validKeys.add(blockTargetKey(block.slug))
		injectBlockHelp(block, context)
	}
	for (const collection of config.collections ?? []) {
		if (excludedCollections.has(collection.slug)) {
			continue
		}
		context.validKeys.add(collectionTargetKey(collection.slug))
		walkFields(collection.fields, `collection:${collection.slug}`, context)
	}
	for (const global of config.globals ?? []) {
		if (excludedGlobals.has(global.slug)) {
			continue
		}
		context.validKeys.add(globalTargetKey(global.slug))
		walkFields(global.fields, `global:${global.slug}`, context)
	}
	return {
		blockLabels: context.blockLabels,
		injectedFieldCount: context.injected.count,
		validTargetKeys: [...context.validKeys].sort(),
	}
}
