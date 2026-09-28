import type { CollectionSlug, Config, PayloadComponent, PayloadRequest } from 'payload'

import { resolveGrants } from '../server/access'
import { parseKey, SYSTEM_AUTHOR } from '../shared/keys'
import type {
	ConversationsExtension,
	ConversationsInstance,
	ConversationsPluginOptions,
	ConversationsTarget,
	ExtensionMap,
	MessageTypeDefinition,
	ResolvedSlots,
	ResolvedUsersConfig,
	SlotComponents,
} from '../types'

/** Who added an entry: the host options, or an extension by name. */
type Owner = string
const HOST: Owner = 'the plugin options'

const TARGET_KINDS = ['collections', 'globals', 'custom'] as const

/** Extension endpoints live at `/<instance>/<name>`, next to these core and transport ones. */
const RESERVED_NAMES = [
	'events',
	'mentions',
	'messages',
	'poll',
	'pusher-auth',
	'read',
	'subscribe',
]

const fail = (instance: string, message: string): never => {
	throw new Error(`[@10x-media/conversations] instance "${instance}": ${message}`)
}

const sameList = (a: string[], b: string[]) =>
	a.length === b.length && a.every((value, index) => value === b[index])

/**
 * Run every extension's `before` in array order, recording who registered each
 * message type and target so a conflict names both parties.
 */
export const runBeforePhases = (
	options: ConversationsPluginOptions
): { extensionMap: ExtensionMap; options: ConversationsPluginOptions } => {
	const slug = options.slug
	const extensions = options.extensions ?? []
	const extensionMap = new Map<string, { options?: unknown }>()
	for (const extension of extensions) {
		if (extensionMap.has(extension.name)) {
			fail(slug, `extension "${extension.name}" is registered twice`)
		}
		if (RESERVED_NAMES.includes(extension.name)) {
			fail(slug, `extension name "${extension.name}" collides with a core endpoint`)
		}
		extensionMap.set(extension.name, { options: extension.options })
	}

	const typeOwners = new Map<string, Owner>()
	const targetOwners = new Map<string, { channels: string[]; owner: Owner }>()

	const record = (current: ConversationsPluginOptions, owner: Owner) => {
		for (const type of current.types ?? []) {
			const previous = typeOwners.get(type.slug)
			if (previous === undefined) {
				typeOwners.set(type.slug, owner)
			}
		}
		for (const kind of TARGET_KINDS) {
			for (const [name, entry] of Object.entries(current.targets?.[kind] ?? {})) {
				const id = `${kind}:${name}`
				const previous = targetOwners.get(id)
				if (previous === undefined) {
					targetOwners.set(id, { channels: [...entry.channels], owner })
					continue
				}
				if (!sameList(previous.channels, entry.channels)) {
					fail(
						slug,
						`target ${kind}.${name} is given different channels by ${previous.owner} and ${owner}`
					)
				}
			}
		}
	}

	const duplicateTypes = (types: MessageTypeDefinition[] | undefined, owner: Owner) => {
		const seen = new Set<string>()
		for (const type of types ?? []) {
			if (seen.has(type.slug)) {
				const first = typeOwners.get(type.slug) ?? owner
				fail(slug, `message type "${type.slug}" is registered by both ${first} and ${owner}`)
			}
			seen.add(type.slug)
		}
	}

	duplicateTypes(options.types, HOST)
	record(options, HOST)

	let current = options
	for (const extension of extensions) {
		if (!extension.before) {
			continue
		}
		const next = extension.before(current, { extensions: extensionMap })
		const owner = `extension "${extension.name}"`
		duplicateTypes(next.types, owner)
		record(next, owner)
		current = next
	}
	return { extensionMap, options: current }
}

const labelFieldOf = (config: Config, collection: string): string => {
	const found = config.collections?.find((candidate) => candidate.slug === collection)
	return found?.admin?.useAsTitle ?? 'id'
}

const resolveUsers = (
	config: Config,
	options: ConversationsPluginOptions
): ResolvedUsersConfig[] => {
	const entries = options.users ?? [config.admin?.user ?? 'users']
	return entries.map((entry) => {
		const collection = typeof entry === 'string' ? entry : entry.collection
		if (collection === SYSTEM_AUTHOR) {
			throw new Error(
				`[@10x-media/conversations] a users collection cannot be named "${SYSTEM_AUTHOR}": system authors use that prefix`
			)
		}
		const custom = typeof entry === 'string' ? undefined : entry.display
		const field = labelFieldOf(config, collection)
		const searchField = field === 'id' ? 'email' : field
		if (custom) {
			return { collection, display: custom, searchField }
		}
		return {
			collection,
			searchField,
			display: (doc: Record<string, unknown>) => {
				const value = doc[field] ?? doc.email ?? doc.id
				return { name: value === undefined || value === null ? '' : String(value) }
			},
		}
	})
}

/**
 * Resolve options (after the `before` phases) into the instance every other
 * part of the plugin works against, validating what can only be checked
 * against the whole picture: channels referenced by targets must exist.
 */
export const resolveInstance = (
	config: Config,
	options: ConversationsPluginOptions,
	extensionMap: ExtensionMap
): ConversationsInstance => {
	const slug = options.slug
	if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
		fail(String(slug), 'slug must be lowercase letters, digits and dashes')
	}

	const channels = new Map((options.channels ?? []).map((channel) => [channel.slug, channel]))
	if (channels.size !== (options.channels ?? []).length) {
		fail(slug, 'channel slugs must be unique')
	}

	const targets = { collections: {}, custom: {}, globals: {} } as ConversationsInstance['targets']
	for (const kind of TARGET_KINDS) {
		for (const [name, entry] of Object.entries(options.targets?.[kind] ?? {})) {
			for (const channel of entry.channels) {
				if (!channels.has(channel)) {
					fail(slug, `target ${kind}.${name} lists unknown channel "${channel}"`)
				}
			}
			targets[kind][name] = [...entry.channels]
		}
	}

	const access = options.access ?? (() => [])

	const channelsFor: ConversationsInstance['channelsFor'] = (target) => {
		const table =
			target.kind === 'collection'
				? targets.collections
				: target.kind === 'global'
					? targets.globals
					: targets.custom
		return table[target.slug] ?? []
	}

	const grants: ConversationsInstance['grants'] = async (req: PayloadRequest, keys: string[]) => {
		const served: ConversationsTarget[] = []
		const offered = new Map<string, string[]>()
		for (const key of new Set(keys)) {
			const parsed = parseKey(key)
			const channels = parsed ? channelsFor(parsed) : []
			if (parsed && channels.length > 0) {
				served.push(parsed)
				offered.set(parsed.key, channels)
			}
		}
		if (served.length === 0 || !req.user) {
			return new Map()
		}
		return resolveGrants(await access({ req, targets: served }), offered)
	}

	const types = new Map<string, MessageTypeDefinition>()
	for (const type of options.types ?? []) {
		if (type.slug === 'text') {
			fail(slug, 'message type slug "text" is reserved')
		}
		types.set(type.slug, type)
	}

	return {
		access,
		grants,
		channels,
		channelsFor,
		deleted: options.deleted ?? 'placeholderIfReplies',
		deleteWithTarget: options.deleteWithTarget ?? true,
		editorFeatures: options.editor ?? (({ defaultFeatures }) => defaultFeatures),
		extensions: extensionMap,
		hooks: options.hooks ?? {},
		limits: {
			bodyBytes: options.limits?.bodyBytes ?? 64 * 1024,
			bodyLength: options.limits?.bodyLength ?? 10_000,
			dataBytes: options.limits?.dataBytes ?? 16 * 1024,
		},
		mentions: {
			max: options.mentions?.max ?? 20,
			users: options.mentions?.users,
			verifyAccess: options.mentions?.verifyAccess ?? false,
		},
		components: options.components ?? {},
		messagesSlug: `${slug}-messages` as CollectionSlug,
		overrides: options.overrides ?? {},
		readsSlug: options.reads === false ? null : (`${slug}-reads` as CollectionSlug),
		extensionList: options.extensions ?? [],
		slots: resolveSlots(options),
		slug,
		systemAuthors: options.systemAuthors ?? {},
		targets,
		transport: options.transport,
		types,
		users: resolveUsers(config, options),
	}
}

const SLOT_NAMES = [
	'composerAbove',
	'composerActions',
	'composerBelow',
	'drawerHeader',
	'messageActions',
	'messageFooter',
	'messageQuickActions',
] as const

const asList = (value: SlotComponents | undefined): PayloadComponent[] =>
	(value === undefined ? [] : Array.isArray(value) ? value : [value]).filter(Boolean)

/** The host's slot components first, then each extension's, in array order. */
export const resolveSlots = (options: ConversationsPluginOptions): ResolvedSlots => {
	const slots = {} as ResolvedSlots
	for (const name of SLOT_NAMES) {
		slots[name] = [
			...asList(options.slots?.[name]),
			...(options.extensions ?? []).flatMap((extension) => asList(extension.slots?.[name])),
		]
	}
	return slots
}

/** Run each extension's `after` in array order. */
export const runAfterPhases = (
	config: Config,
	instance: ConversationsInstance,
	extensions: ConversationsExtension[]
): Config => {
	let current = config
	for (const extension of extensions) {
		if (extension.after) {
			current = extension.after({ config: current, extensions: instance.extensions, instance })
		}
	}
	return current
}
