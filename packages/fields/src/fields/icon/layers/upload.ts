import type { CollectionSlug, Payload, Where } from 'payload'
import type { IconLayer, IconLayerCache, IconLayerContext, IconMeta } from '../../../types'

/** Document shape the layer reads, after the configurable field names are applied. */
type UploadDoc = Record<string, unknown>

/**
 * Widens one document to a bag of fields.
 *
 * Payload types `find` as the document union of the host app's collections, and a generated
 * document type has no index signature, so asserting the array directly is rejected wherever
 * types have been generated. That is the dev app and every real consumer, and it is why this
 * only shows up outside the package's own typecheck. Taking `unknown` keeps it one legal
 * assertion rather than a double cast.
 */
const asUploadDoc = (doc: unknown): UploadDoc => doc as UploadDoc

export type UploadIconLayerOptions = {
	/** Upload collection holding the icons. */
	collection: CollectionSlug
	/** Layer id, unique within the adapter. Defaults to the collection slug. */
	id?: string
	/** Field holding the icon name that becomes part of the stored value. Defaults to `name`. */
	nameField?: string
	/** Field holding the human-readable label. Defaults to `label`. */
	labelField?: string
	/** Field holding search tags, a string array. Defaults to `tags`. */
	tagsField?: string
	/** Field holding categories, a string array. Defaults to `categories`. */
	categoriesField?: string
	/**
	 * Extra constraint, typically tenant scoping. Receives the request so it can read the
	 * caller. Supply `cacheKey` alongside it, or one caller's listing is served to another.
	 */
	where?: (ctx: IconLayerContext) => Where | undefined
	/**
	 * Cache-key segment for a scoped layer. Required whenever `where` varies by request:
	 * the listing cache is otherwise keyed by adapter slug and layer id alone.
	 */
	cacheKey?: (ctx: IconLayerContext) => string
	/** Listing cache policy. Defaults to a 30 second TTL, since uploads change at runtime. */
	cache?: IconLayerCache
	/**
	 * How glyphs paint. `'url'` is the default and renders each icon through an `<img>`,
	 * which is inert by construction: an SVG loaded that way cannot execute script.
	 *
	 * `'svg'` inlines the markup instead, which allows `currentColor` recolouring but means
	 * rendering editor-uploaded markup inside the admin. On a multi-tenant install the
	 * uploader may be a customer rather than an operator, so that is a deliberate choice
	 * with a real blast radius. The markup is sanitised either way; `'url'` simply removes
	 * the question.
	 */
	render?: 'url' | 'svg'
	/** importMap path resolving `(name: string) => null | string` for the `url` strategy. */
	resolveUrl?: string
	/** importMap path resolving `() => Promise<Record<string, string>>` for the `svg` strategy. */
	loadSvgs?: string
}

const DEFAULT_TTL = 30_000

const asStrings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const toMeta = (doc: UploadDoc, options: Required<FieldNames>): IconMeta | null => {
	const name = doc[options.nameField]
	if (typeof name !== 'string' || name === '') return null
	const label = doc[options.labelField]
	return {
		categories: asStrings(doc[options.categoriesField]),
		name,
		tags: asStrings(doc[options.tagsField]),
		...(typeof label === 'string' && label !== '' ? { label } : {}),
	}
}

type FieldNames = {
	categoriesField: string
	labelField: string
	nameField: string
	tagsField: string
}

const findDocs = async (args: {
	ctx: IconLayerContext
	collection: CollectionSlug
	payload: Payload
	where: Where | undefined
}): Promise<UploadDoc[]> => {
	const result = await args.payload.find({
		collection: args.collection,
		depth: 0,
		limit: 0,
		pagination: false,
		...(args.ctx.req ? { req: args.ctx.req } : {}),
		...(args.where ? { where: args.where } : {}),
	})
	return result.docs.map(asUploadDoc)
}

/**
 * An icon layer backed by a Payload upload collection, so editors can add icons without a
 * deploy.
 *
 * This is the preset that proves the layer contract holds: if a real upload-backed library
 * needs anything expressible only here and not through `IconLayer`, that is a gap in the
 * contract rather than in this file.
 *
 * Validation never reads the listing cache. `resolveMetaMany` answers from one indexed
 * query, so an icon uploaded a moment ago is valid immediately, on every instance, rather
 * than after a cache expiry or a restart.
 */
export const uploadIconLayer = (options: UploadIconLayerOptions): IconLayer => {
	const fields: Required<FieldNames> = {
		categoriesField: options.categoriesField ?? 'categories',
		labelField: options.labelField ?? 'label',
		nameField: options.nameField ?? 'name',
		tagsField: options.tagsField ?? 'tags',
	}
	const strategy = options.render ?? 'url'
	if (strategy === 'url' && !options.resolveUrl) {
		throw new Error('[fields] uploadIconLayer: the url strategy needs a resolveUrl import path')
	}
	if (strategy === 'svg' && !options.loadSvgs) {
		throw new Error('[fields] uploadIconLayer: the svg strategy needs a loadSvgs import path')
	}

	const scopedWhere = (ctx: IconLayerContext): Where | undefined => options.where?.(ctx)

	return {
		cache: options.cache ?? { ttl: DEFAULT_TTL },
		...(options.cacheKey ? { cacheKey: options.cacheKey } : {}),
		id: options.id ?? String(options.collection),
		loadManifest: async (ctx) => {
			const docs = await findDocs({
				collection: options.collection,
				ctx,
				payload: ctx.payload,
				where: scopedWhere(ctx),
			})
			const icons = docs
				.map((doc) => toMeta(doc, fields))
				.filter((icon): icon is IconMeta => icon !== null)
			const categories = [...new Set(icons.flatMap((icon) => icon.categories))].sort()
			return { categories, icons }
		},
		render:
			strategy === 'url'
				? { resolve: options.resolveUrl ?? '', type: 'url' }
				: { load: options.loadSvgs ?? '', type: 'svg' },
		resolveMeta: async (name, ctx) => {
			const scoped = scopedWhere(ctx)
			const where: Where = scoped
				? { and: [scoped, { [fields.nameField]: { equals: name } }] }
				: { [fields.nameField]: { equals: name } }
			const result = await ctx.payload.find({
				collection: options.collection,
				depth: 0,
				limit: 1,
				...(ctx.req ? { req: ctx.req } : {}),
				where,
			})
			const doc = result.docs.map(asUploadDoc)[0]
			return doc ? toMeta(doc, fields) : null
		},
		// One `in` query for every name looked up in the tick. A document holding eight icon
		// fields, or a fifty-row list, costs one query rather than eight or fifty.
		resolveMetaMany: async (names, ctx) => {
			const scoped = scopedWhere(ctx)
			const where: Where = scoped
				? { and: [scoped, { [fields.nameField]: { in: names } }] }
				: { [fields.nameField]: { in: names } }
			const result = await ctx.payload.find({
				collection: options.collection,
				depth: 0,
				limit: 0,
				pagination: false,
				...(ctx.req ? { req: ctx.req } : {}),
				where,
			})
			const found = new Map<string, IconMeta>()
			for (const doc of result.docs.map(asUploadDoc)) {
				const meta = toMeta(doc, fields)
				if (meta) found.set(meta.name, meta)
			}
			return found
		},
	}
}
