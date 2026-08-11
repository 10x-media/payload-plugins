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
	/** Slugs of every block the plugin covers, sorted, for the block target picker. */
	blockSlugs: string[]
	/** Named fields that received the injected Description component. */
	injectedFieldCount: number
	/** Every target key that resolves against the walked config. */
	validTargetKeys: string[]
	/** Config problems worth telling the host about, logged once on init. */
	warnings: string[]
}

const DESCRIPTION_COMPONENT = '@10x-media/admin-wiki/client#WikiFieldDescription'
const BLOCK_HELP_COMPONENT = '@10x-media/admin-wiki/client#WikiBlockHelp'

/**
 * Name of the UI field carrying a block's guides. Namespaced because it lands
 * in host block schemas; a block already declaring it keeps its own.
 */
export const WIKI_BLOCK_HELP_FIELD = 'adminWikiBlockHelp'

/** A block queued for its own walk, with where it was found, for warnings. */
type QueuedBlock = { block: Block; origin: string }

type WalkContext = {
	blockLabels: Record<string, string>
	blocksBySlug: Map<string, Block>
	/** Field keys of the block currently being walked, for divergence detection. */
	collecting: null | Set<string>
	excludedBlocks: Set<string>
	/** Where a slug was first seen, and which field keys that first object produced. */
	firstBlockOfSlug: Map<string, { fieldKeys: Set<string>; origin: string }>
	helpedBlocks: Set<string>
	pendingBlocks: QueuedBlock[]
	validKeys: Set<string>
	visitedBlocks: Set<Block>
	warnedSlugs: Set<string>
	warnings: string[]
	injected: { count: number }
}

/**
 * Skip fields that already carry a custom Description component (we never
 * replace consumer components) and function descriptions (not serializable
 * into client props); both cases are documented integration limitations.
 */
const injectDescription = (field: Field, schemaPath: string, context: WalkContext): void => {
	const key = fieldTargetKey(schemaPath)
	context.validKeys.add(key)
	context.collecting?.add(key)
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
 * Shared block configs (`config.blocks` / `blockReferences`) are mutated once,
 * because the caller dedupes by object identity. Two *distinct* objects sharing
 * a slug are both mutated, so the help field renders at either one's usages; only
 * the bookkeeping (slug list, label) is deduped, and it keeps the first walked,
 * which is the registry variant wherever one exists.
 */
const injectBlockHelp = (block: Block, context: WalkContext): void => {
	if (!context.helpedBlocks.has(block.slug)) {
		context.helpedBlocks.add(block.slug)
		const singular = block.labels?.singular
		if (typeof singular === 'string') {
			context.blockLabels[block.slug] = singular
		}
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

/**
 * Register a block for its own walk. Blocks are keyed by slug but queued by
 * object identity: a shared config object reached from ten usages is walked
 * once, while two different objects that happen to share a slug are both walked
 * (and both mutated) under the one `block:<slug>` root, merging their fields.
 *
 * `origin` is where the object was found, used only in the divergence warning.
 */
const queueBlock = (block: Block, origin: string, context: WalkContext): void => {
	if (context.excludedBlocks.has(block.slug) || context.visitedBlocks.has(block)) {
		return
	}
	context.visitedBlocks.add(block)
	context.validKeys.add(blockTargetKey(block.slug))
	injectBlockHelp(block, context)
	context.pendingBlocks.push({ block, origin })
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
					queueBlock(block, path, context)
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
 * Walk one queued block's interior, rooted at `block:<slug>` so a field inside a
 * block is one target wherever that block renders, in any collection, global, or
 * enclosing block.
 *
 * The field keys the walk produces double as the block's signature: when a
 * second object with the same slug produces a different set, the two variants
 * disagree about what the slug means, and only one of them can be shown wherever
 * a single schema has to be picked. Payload allows that (its duplicate check
 * runs per blocks field, not across the config), so warn rather than fail.
 */
const walkBlock = ({ block, origin }: QueuedBlock, context: WalkContext): void => {
	const fieldKeys = new Set<string>()
	context.collecting = fieldKeys
	walkFields(block.fields, `block:${block.slug}`, context)
	context.collecting = null
	const first = context.firstBlockOfSlug.get(block.slug)
	if (!first) {
		context.firstBlockOfSlug.set(block.slug, { fieldKeys, origin })
		return
	}
	const diverges =
		first.fieldKeys.size !== fieldKeys.size ||
		[...fieldKeys].some((key) => !first.fieldKeys.has(key))
	if (diverges && !context.warnedSlugs.has(block.slug)) {
		context.warnedSlugs.add(block.slug)
		context.warnings.push(
			`@10x-media/admin-wiki: two different blocks share the slug "${block.slug}" with different ` +
				`fields (${first.origin}, ${origin}). Their field targets merge under "block:${block.slug}", ` +
				'and the first one wins wherever a single variant has to be shown.'
		)
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
 * in a namespace of its own; an inline block reachable only from an excluded
 * collection is never discovered either, so it ends up unhelped without being
 * named. A registry block (`config.blocks`) is covered whether or not anything
 * uses it, as it always was.
 *
 * Schema paths are rooted at `collection:<slug>`, `global:<slug>`, or
 * `block:<slug>` rather than the bare slug: Payload only enforces slug
 * uniqueness within collections (`DuplicateCollection` in its config
 * sanitizer), so a collection and a global may share one, and an unqualified
 * path would silently merge their fields.
 *
 * Block interiors are their own roots, walked in a pass after the entities. An
 * entity walk stops at the blocks field itself (`collection:posts.layout`
 * belongs to the collection), and the block pass then walks each covered block
 * once under `block:<slug>`. That makes a field inside a block one target
 * everywhere the block is used instead of one per usage, and it is also the only
 * way the injection can be right at all: a shared block config is a single
 * object, so the entity-scoped path it used to carry was whichever entity
 * happened to be walked first.
 */
export const walkAndInjectFieldHelp = (
	config: Config,
	resolved: ResolvedWikiOptions
): WalkResult => {
	const context: WalkContext = {
		blockLabels: {},
		blocksBySlug: new Map((config.blocks ?? []).map((block) => [block.slug, block])),
		collecting: null,
		excludedBlocks: new Set(resolved.exclude.blocks),
		firstBlockOfSlug: new Map(),
		injected: { count: 0 },
		helpedBlocks: new Set<string>(),
		pendingBlocks: [],
		validKeys: new Set<string>(),
		visitedBlocks: new Set<Block>(),
		warnedSlugs: new Set<string>(),
		warnings: [],
	}
	const excludedCollections = new Set(resolved.exclude.collections)
	const excludedGlobals = new Set(resolved.exclude.globals)
	// Registry blocks first, so a slug shared with an inline block resolves to the
	// registry variant's label and schema, matching core's `blocksMap` precedence.
	for (const block of config.blocks ?? []) {
		queueBlock(block, 'config.blocks', context)
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
	// Drained rather than iterated: a block's own blocks fields queue more blocks.
	for (let index = 0; index < context.pendingBlocks.length; index += 1) {
		walkBlock(context.pendingBlocks[index] as QueuedBlock, context)
	}
	return {
		blockLabels: context.blockLabels,
		blockSlugs: [...context.helpedBlocks].sort(),
		injectedFieldCount: context.injected.count,
		validTargetKeys: [...context.validKeys].sort(),
		warnings: context.warnings,
	}
}
