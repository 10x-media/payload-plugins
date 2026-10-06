import { createHash } from 'node:crypto'
import { getTranslation, type I18nClient } from '@payloadcms/translations'
import {
	APIError,
	type CollectionSlug,
	getFieldByPath,
	type Payload,
	type PayloadRequest,
	parseCookies,
	type SanitizedCollectionConfig,
	type Where,
} from 'payload'

import { resolveCompare } from '../match/presets'
import type { ResolvedMatchField } from '../match/score'
import type { MatchFieldConfig, ResolvedCollectionOptions, ResolvedOptions } from '../options'
import { deriveSpec, resolveSpec } from '../schema/deriveSpec'
import { deriveReferences, resolveReferences } from '../schema/references'
import type { MergeFieldSpec, ReferenceSpec } from '../schema/types'
import type { DedupeAdapter } from '../search/contract'

export type CollectionContext = {
	slug: CollectionSlug
	config: SanitizedCollectionConfig
	options: ResolvedCollectionOptions
	spec: MergeFieldSpec[]
	specByPath: Map<string, MergeFieldSpec>
	/** Empty when the collection has no `match` config. */
	matchFields: ResolvedMatchField[]
	/** Identifies the match config the stored keys and pairs were computed with. */
	configHash: string
	hasDrafts: boolean
	/**
	 * Scoped by tenant: listed in `multiTenancy.collections`, or without that list, has the
	 * tenant field. One that is not is shared by every tenant.
	 */
	tenanted: boolean
	/** Fields elsewhere that point at this collection, moved to the survivor on a merge. */
	references: ReferenceSpec[]
	/** Where candidates come from: the collection's own adapter, or the plugin's. */
	adapter: DedupeAdapter
}

export type PluginContext = {
	options: ResolvedOptions
	collections: Map<string, CollectionContext>
	/** Host locale codes, or null without localization. */
	localeCodes: string[] | null
	defaultLocale: string | null
	/** Name of the tenant field when the search is tenant-scoped. */
	tenantFieldName: string | null
	/** Slugs with a full scan in flight on this instance, so a second one is refused. */
	scanning: Set<string>
}

/**
 * The context lives on the Payload instance, not in its config: an HMR `reload()` swaps
 * `payload.config` and never runs `onInit` again, and the context built for the first
 * config stays. `Symbol.for` resolves to the same key when the package loads twice, as it
 * does with the development alias beside `dist`. The same as analytics' runtime.
 */
const CONTEXT_KEY = Symbol.for('@10x-media/dedupe/context')

type ContextHost = { [CONTEXT_KEY]?: PluginContext }

/** Raised when the presets fold values into keys differently (accents, letters, words). */
const KEY_FORMAT = 2

/**
 * Fingerprint of what the stored keys were computed from: the paths, the presets and which
 * fields key at all. Weights and penalties only score, so changing them keeps the keys.
 * Taken before the presets are resolved: resolved they are all objects whose key function
 * is called `keys`, and the name would no longer tell `text` from `exact`. A custom
 * function is hashed by its source, so editing it retires the keys it produced.
 */
export const hashMatch = (fields: MatchFieldConfig[]): string => {
	const hash = createHash('sha1')
	// How values are folded into keys: a change to it retires the keys stored before.
	hash.update(`keys:${KEY_FORMAT}\n`)
	for (const field of fields) {
		const compare =
			typeof field.compare === 'object'
				? `fn:${field.compare.keys.toString()}`
				: field.compare === 'number'
					? `number:${field.toleranceType ?? 'value'}:${field.tolerance ?? 0}`
					: (field.compare ?? 'exact')
		hash.update(`${field.path}|${compare}|${field.key !== false}\n`)
	}
	return hash.digest('hex').slice(0, 12)
}

const buildCollectionContext = (
	payload: Payload,
	options: ResolvedCollectionOptions,
	plugin: Pick<ResolvedOptions, 'tenantCollections' | 'tenantFieldName'> & {
		adapter: DedupeAdapter
	}
): CollectionContext => {
	const { tenantFieldName, tenantCollections, adapter } = plugin
	const collection = payload.collections[options.slug]
	if (!collection) {
		throw new Error(`dedupe: collection "${options.slug}" is not registered`)
	}
	const config = collection.config
	if (config.upload) {
		throw new Error(`dedupe: upload collection "${options.slug}" is not supported`)
	}

	const tenanted =
		tenantFieldName !== null &&
		(tenantCollections
			? tenantCollections.includes(options.slug)
			: config.flattenedFields.some((field) => field.name === tenantFieldName))

	// Every document of a merge shares the tenant, and nothing may move the survivor to another.
	const spec = resolveSpec(
		deriveSpec(
			config,
			payload.config.folders ? payload.config.folders.fieldName : undefined,
			payload.config.blocks
		),
		options.fields,
		options.slug
	).map((entry) =>
		tenanted && entry.path === tenantFieldName ? { ...entry, policy: 'survivor' as const } : entry
	)
	const specByPath = new Map(spec.map((entry) => [entry.path, entry]))

	const matchFields: ResolvedMatchField[] = (options.match?.fields ?? []).map((field) => {
		const found = specByPath.get(field.path)
		if (!found) {
			const segments = field.path.split('.')
			const along = segments.map(
				(_, index) =>
					getFieldByPath({
						fields: config.flattenedFields,
						path: segments.slice(0, index + 1).join('.'),
					})?.field
			)
			const where = `match field "${field.path}" on collection "${options.slug}"`
			const inside = along
				.slice(0, -1)
				.some(
					(entry) =>
						entry?.type === 'array' ||
						entry?.type === 'blocks' ||
						((entry?.type === 'group' || entry?.type === 'tab') && entry.localized === true)
				)
			throw new Error(
				along.some((entry) => entry?.hidden === true)
					? `dedupe: ${where} is hidden from the API, so it is never read`
					: !along.at(-1)
						? `dedupe: match field "${field.path}" does not exist on collection "${options.slug}"`
						: inside
							? `dedupe: ${where} sits inside rows or a localized group, which are compared whole; match on a field outside them`
							: `dedupe: ${where} is not merged: a system, virtual or join field, or one the \`fields\` option leaves out`
			)
		}
		// Rows, a group, rich text, JSON or a point are compared by every value inside them at
		// once: their ids and node settings match in any two documents, or two places on one
		// latitude do.
		const whole: Record<string, string> = {
			array: 'rows',
			blocks: 'rows',
			group: 'a group',
			richText: 'rich text',
			json: 'JSON',
			point: 'a point',
		}
		const held = whole[found.type]
		if (held) {
			throw new Error(
				`dedupe: match field "${field.path}" on collection "${options.slug}" holds ${held}, which is not compared`
			)
		}
		return {
			...field,
			compare: resolveCompare(field.compare, field),
			localized: found.localized,
		}
	})

	const absorbed = options.absorbed ?? (config.trash ? 'trash' : 'delete')
	if (absorbed === 'trash' && !config.trash) {
		throw new Error(
			`dedupe: collection "${options.slug}" has no trash; enable \`trash: true\` or set \`absorbed: 'delete'\` to hard-delete absorbed documents`
		)
	}

	return {
		slug: options.slug,
		config,
		options: { ...options, absorbed },
		spec,
		specByPath,
		matchFields,
		configHash: hashMatch(options.match?.fields ?? []),
		hasDrafts: Boolean(config.versions?.drafts),
		tenanted,
		references: resolveReferences(
			deriveReferences(payload.config, options.slug),
			options.references,
			options.slug
		),
		adapter,
	}
}

/**
 * Where the config keeps what the context is built from, for a Payload started without
 * `onInit` (`payload migrate`, migrations run on connect): its hooks still need one. The
 * root `custom` stays on the server.
 */
export const CONTEXT_SOURCE = '@10x-media/dedupe'

/** The plugin's adapter, and the collections' own by slug. */
export type Adapters = { plugin: DedupeAdapter; own: ReadonlyMap<string, DedupeAdapter> }

type ContextSource = { options: ResolvedOptions; adapters: Adapters }

/**
 * Runs from `onInit`, after the config is sanitized, so every path is validated at boot; or on
 * first use when Payload started without `onInit`.
 */
export const buildContext = (
	payload: Payload,
	options: ResolvedOptions,
	adapters: Adapters
): PluginContext => {
	const localization = payload.config.localization
	const context: PluginContext = {
		options,
		collections: new Map(),
		localeCodes: localization ? localization.localeCodes : null,
		defaultLocale: localization ? localization.defaultLocale : null,
		tenantFieldName: options.tenantFieldName,
		scanning: new Set(),
	}
	for (const entry of options.collections) {
		context.collections.set(
			entry.slug,
			buildCollectionContext(payload, entry, {
				tenantFieldName: options.tenantFieldName,
				tenantCollections: options.tenantCollections,
				adapter: adapters.own.get(entry.slug) ?? adapters.plugin,
			})
		)
	}
	;(payload as unknown as ContextHost)[CONTEXT_KEY] = context
	return context
}

export const getContext = (payload: Payload): PluginContext => {
	const context = (payload as unknown as ContextHost)[CONTEXT_KEY]
	if (context) return context
	const source = payload.config.custom?.[CONTEXT_SOURCE] as ContextSource | null | undefined
	if (source === null) throw new Error('dedupe: the plugin is disabled (`disabled: true`)')
	if (!source) throw new Error('dedupe: plugin context missing; is the plugin in the config?')
	return buildContext(payload, source.options, source.adapters)
}

/** The configured collections as the queue lists them. */
export const listCollections = (
	ctx: PluginContext,
	i18n: I18nClient
): { slug: string; label: string; hasMatch: boolean }[] =>
	[...ctx.collections.values()].map((col) => ({
		slug: col.slug as string,
		label: getTranslation(col.config.labels.plural, i18n),
		hasMatch: col.matchFields.length > 0,
	}))

/** A request named an unconfigured collection: the caller's mistake, not a server fault. */
export const getCollectionContext = (payload: Payload, slug: string): CollectionContext => {
	const collection = getContext(payload).collections.get(slug)
	if (!collection) {
		throw new APIError(
			`dedupe: collection "${slug}" is not configured for dedupe`,
			400,
			undefined,
			true
		)
	}
	return collection
}

/**
 * The tenant the reviewer has selected, from the cookie the multi-tenant plugin sets. Only
 * the server reads it: a request cannot name another tenant. Null with tenancy off or with
 * no tenant selected, and then nothing is narrowed by tenant.
 */
export const selectedTenant = (ctx: PluginContext, req: PayloadRequest): string | null =>
	ctx.tenantFieldName ? (parseCookies(req.headers).get('payload-tenant') ?? null) : null

/**
 * What a list of pairs or merges is narrowed to while a tenant is selected: that tenant's
 * rows, and the rows of collections without the tenant field, which belong to no tenant.
 */
export const tenantScope = (ctx: PluginContext, req: PayloadRequest): Where[] => {
	const tenant = selectedTenant(ctx, req)
	if (!tenant) return []
	const shared = [...ctx.collections.values()].filter((col) => !col.tenanted).map((col) => col.slug)
	return [
		shared.length > 0
			? { or: [{ tenant: { equals: tenant } }, { target: { in: shared } }] }
			: { tenant: { equals: tenant } },
	]
}

/**
 * The match fields of a configured collection, as its `match` config lists them; empty
 * without one.
 */
export const matchFields = (payload: Payload, collection: string): MatchFieldConfig[] =>
	getCollectionContext(payload, collection).options.match?.fields ?? []

/**
 * The tenant a document of a configured collection belongs to, as an id, whatever shape the
 * relationship arrived in. Null with `multiTenancy` off and in a collection it does not scope.
 */
export const tenantOf = (
	payload: Payload,
	collection: string,
	doc: Record<string, unknown>
): string | null => {
	const { tenantFieldName } = getContext(payload)
	if (!tenantFieldName || !getCollectionContext(payload, collection).tenanted) return null
	const value = doc[tenantFieldName]
	if (value === null || value === undefined) return null
	if (typeof value === 'string' || typeof value === 'number') return String(value)
	if (typeof value === 'object' && 'id' in (value as object)) {
		return String((value as { id: unknown }).id)
	}
	return null
}

/**
 * The user behind a request as `collection:id`, so a history names them from the right
 * auth collection when the app has several.
 */
export const userRef = (req: PayloadRequest): string | null =>
	req.user ? `${req.user.collection}:${String(req.user.id)}` : null

/**
 * Marks writes the plugin makes itself, so its own hooks and the host's stand down. A new
 * object each time: Payload hands a write's context to the request, and hooks write into it.
 */
export const dedupeContext = (): { dedupe: { operation: 'merge' } } => ({
	dedupe: { operation: 'merge' },
})
