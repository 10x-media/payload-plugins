import type { Block, Config, Field } from 'payload'

import {
	blockTargetKey,
	collectionTargetKey,
	fieldTargetKey,
	globalTargetKey,
} from '../shared/targetKeys'
import type { ResolvedWikiOptions } from './resolveOptions'

export type WalkResult = {
	/** Named fields that received the injected Description component. */
	injectedFieldCount: number
	/** Every target key that resolves against the walked config. */
	validTargetKeys: string[]
}

const DESCRIPTION_COMPONENT = '@10x-media/admin-wiki/client#WikiFieldDescription'
const BLOCK_LABEL_COMPONENT = '@10x-media/admin-wiki/rsc#WikiBlockLabel'

type WalkContext = {
	blocksBySlug: Map<string, Block>
	labeledBlocks: Set<string>
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
 * Inject the guide trigger into a block's row label, keeping the default label
 * text via the server-provided `rowLabel`. Shared block configs (from
 * `config.blocks` / `blockReferences`) are mutated once; a block that already
 * carries a custom Label component is left alone (documented limitation).
 */
const injectBlockLabel = (block: Block, context: WalkContext): void => {
	if (context.labeledBlocks.has(block.slug)) {
		return
	}
	context.labeledBlocks.add(block.slug)
	const components = block.admin?.components as { Label?: unknown } | undefined
	if (components?.Label !== undefined) {
		return
	}
	block.admin = {
		...block.admin,
		components: {
			...block.admin?.components,
			Label: {
				clientProps: { blockSlug: block.slug },
				path: BLOCK_LABEL_COMPONENT,
			},
		},
	}
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
					context.validKeys.add(blockTargetKey(block.slug))
					injectBlockLabel(block, context)
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
 * Walk every collection and global (except the wiki's own), injecting the
 * field-help Description component on every named field and collecting the set
 * of valid target keys for orphan detection. One walk, two outputs.
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
		blocksBySlug: new Map((config.blocks ?? []).map((block) => [block.slug, block])),
		injected: { count: 0 },
		labeledBlocks: new Set<string>(),
		validKeys: new Set<string>(),
	}
	const wikiSlugs = [resolved.slugs.pages, resolved.slugs.media]
	for (const block of config.blocks ?? []) {
		context.validKeys.add(blockTargetKey(block.slug))
		injectBlockLabel(block, context)
	}
	for (const collection of config.collections ?? []) {
		if (wikiSlugs.includes(collection.slug)) {
			continue
		}
		context.validKeys.add(collectionTargetKey(collection.slug))
		walkFields(collection.fields, `collection:${collection.slug}`, context)
	}
	for (const global of config.globals ?? []) {
		context.validKeys.add(globalTargetKey(global.slug))
		walkFields(global.fields, `global:${global.slug}`, context)
	}
	return {
		injectedFieldCount: context.injected.count,
		validTargetKeys: [...context.validKeys].sort(),
	}
}
