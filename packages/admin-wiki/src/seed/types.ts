import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'

/** The surfaces a seeded guide attaches to, one list per target kind. */
export type WikiSeedTargets = {
	/** Block slugs, e.g. `heroBanner`. */
	blocks?: string[]
	/** Collection slugs, e.g. `posts`. */
	collections?: string[]
	/**
	 * Entity-qualified field schema paths, e.g. `collection:posts.hero.title` or
	 * `global:settings.siteName`.
	 */
	fields?: string[]
	/** Global slugs, e.g. `settings`. */
	globals?: string[]
}

/**
 * A value that is either one plain value (written in the default locale) or a
 * record keyed by content locale codes.
 */
export type WikiSeedLocalized<T> = Record<string, T> | T

/** Guide content: markdown converted through the wiki editor, or raw lexical. */
export type WikiSeedContent = { lexical: SerializedEditorState } | { markdown: string }

/** Resolution data transformers embed references with. */
export type WikiSeedContext = {
	/** Every seeded guide's id by slug (resolved before content is written). */
	guideIdsBySlug: Record<string, number | string>
	/** Seeded media handles by media key. */
	media: Record<string, { id: number | string; relationTo: string }>
}

/**
 * A post-processor over converted lexical JSON. Transformers run in order
 * (built-ins first, then consumer-supplied) and may mutate the state they
 * receive; each must return the state it wants passed on.
 */
export type WikiSeedTransformer = (
	state: SerializedEditorState,
	context: WikiSeedContext
) => SerializedEditorState

export type WikiSeedMediaDef = {
	alt?: WikiSeedLocalized<string>
	/** Local file path (absolute, or relative to the working directory). */
	file?: string
	/** Stable identity across runs; also the name used in content placeholders. */
	key: string
	/** Remote URL fetched at seed time. Exactly one of `file` / `url`. */
	url?: string
}

export type WikiSeedGuideDef = {
	content: WikiSeedLocalized<WikiSeedContent>
	featured?: boolean
	featuredOrder?: number
	/** Publish after writing; false leaves the guide as a draft. Default true. */
	publish?: boolean
	/** Stable identity across runs; re-running updates instead of duplicating. */
	slug: string
	summary?: WikiSeedLocalized<string>
	targets?: WikiSeedTargets
	title: WikiSeedLocalized<string>
}

export type WikiSeedOptions = {
	media?: WikiSeedMediaDef[]
	/** Extra transformers appended after the built-in pipeline. */
	transformers?: WikiSeedTransformer[]
}

export type WikiSeedResult = {
	guides: Array<{ action: 'created' | 'updated'; id: number | string; slug: string }>
	media: Record<string, { id: number | string; relationTo: string }>
}
