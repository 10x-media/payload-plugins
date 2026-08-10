import type { Access, Block, CollectionConfig } from 'payload'

import type { TranslationsOption } from './translations'

/** Payload's `admin.hidden` shape, reused so the passthrough stays in lockstep. */
export type HiddenOption = NonNullable<CollectionConfig['admin']>['hidden']

/**
 * Access predicates overriding the plugin defaults (any logged-in user for every
 * operation). Each receives Payload's standard access args including `req` (and
 * therefore `req.locale`), so consumers can restrict authoring per role and per
 * locale. Consumers are expected to restrict `create`/`update`/`delete`.
 */
export type WikiAccessOptions = {
	create?: Access
	delete?: Access
	read?: Access
	update?: Access
}

/** Collection slugs the plugin registers. */
export type WikiSlugsOptions = {
	/** Guide pages collection slug. Defaults to `wiki-pages`. */
	pages?: string
	/** Wiki media upload collection slug. Defaults to `wiki-media`. */
	media?: string
}

/** Per-collection `admin.hidden` passthrough; both collections are visible by default. */
export type WikiHiddenOptions = {
	media?: HiddenOption
	pages?: HiddenOption
}

/** Video authoring options; the feature is off unless this is set. */
export type WikiVideoOptions = {
	/**
	 * Import-map path of a client component replacing the default HTML5 player
	 * for uploaded videos. It receives the `wiki-media` document as a prop.
	 */
	playerComponent?: string
}

/** A consumer block available in the wiki editor, with its read-side renderer. */
export type WikiEditorBlockOption = {
	block: Block
	/** Import-map path of the client component rendering this block in guides. */
	component: string
}

/** Extensions to the plugin's self-contained editor. */
export type WikiEditorOptions = {
	blocks?: WikiEditorBlockOption[]
}

/**
 * When the "write this guide" affordances render for users whose create
 * permission resolves true. Field-level surfaces put one affordance next to
 * every unguided field, so `always` is deliberately not the default.
 *
 * - `editMode`: only while the reader has wiki edit mode on, a per-browser
 *   toggle the plugin persists in `localStorage`.
 * - `always`: whenever create permission resolves true.
 * - `never`: no write affordance anywhere; guides are authored from the wiki
 *   collection itself.
 */
export type WikiWriteAffordanceMode = 'always' | 'editMode' | 'never'

/** List-view slot the guides band renders in. */
export type WikiListBandSlot = 'afterList' | 'afterListTable' | 'beforeList' | 'beforeListTable'

/** The guides band on collection list views. */
export type WikiListBandOptions = {
	/** Which list slot to render in. Defaults to `afterListTable`. */
	slot?: WikiListBandSlot
}

/**
 * Which surfaces carry a guide affordance; `false` disables one.
 *
 * There is no slot to choose per surface, because each has exactly one place the
 * affordance belongs: documents and globals put it in the sidebar, beside the
 * other document-scoped facts, and lists have no sidebar so they get a band.
 * Only the band's slot is configurable, because where a block of content sits on
 * a list is a real layout question.
 */
export type WikiTriggersOptions = {
	/** Document edit views: a guides panel in the sidebar. Defaults to `true`. */
	edit?: boolean
	/** Global edit views: a guides panel in the sidebar. Defaults to `true`. */
	global?: boolean
	/** Collection list views: the guides band. Defaults to `true`. */
	list?: boolean | WikiListBandOptions
}

/**
 * Slugs the plugin leaves alone entirely: no help on their fields, no guides
 * panel, no list band, and no entry in the target pickers, so a guide cannot be
 * attached to one even in wiki edit mode.
 *
 * Kept per entity kind because Payload only enforces slug uniqueness within one
 * kind. A collection, a global, and a block may all be called `settings`, and a
 * single flat list would exclude three unrelated things at once.
 *
 * These add to the built-in exclusions: Payload's own bookkeeping collections
 * and globals (`PAYLOAD_INTERNAL_COLLECTIONS`, `PAYLOAD_INTERNAL_GLOBALS`) and
 * the wiki's own two collections.
 */
export type WikiExcludeOptions = {
	/** Block slugs that get no block help and cannot be targeted. */
	blocks?: string[]
	/** Collection slugs the plugin does not touch. */
	collections?: string[]
	/** Global slugs the plugin does not touch. */
	globals?: string[]
}

export type AdminWikiPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/admin-wiki/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/**
	 * Access overrides for the wiki collections. Defaults allow any logged-in
	 * user to read AND author; restrict authoring in production projects.
	 */
	access?: WikiAccessOptions
	/** Extensions to the wiki editor (consumer blocks with renderers). */
	editor?: WikiEditorOptions
	/** Entities the plugin leaves alone entirely. See {@link WikiExcludeOptions}. */
	exclude?: WikiExcludeOptions
	/**
	 * Lead the list band with the collection's featured guides as cards. `false`
	 * collapses the band to its "all guides" row; the wiki view leads with
	 * featured guides either way. Defaults to `true`.
	 */
	featured?: boolean
	/** Per-collection `admin.hidden` passthrough. */
	hidden?: WikiHiddenOptions
	/**
	 * Maps admin UI languages (`i18n.language`) to content locales for projects
	 * whose two axes use different keys. Readers resolve guides through their
	 * admin language, this map, then the default locale.
	 */
	localeMap?: Record<string, string>
	/** Collection slug overrides. */
	slugs?: WikiSlugsOptions
	/** Guide trigger placement per surface. */
	triggers?: WikiTriggersOptions
	/**
	 * Enable video in the wiki: uploaded videos in `wiki-media` plus YouTube and
	 * Vimeo embeds in the editor. `true` uses the default HTML5 player.
	 */
	video?: boolean | WikiVideoOptions
	/** Register the `/wiki` browsing and reading views. Defaults to `true`. */
	wikiView?: boolean
	/**
	 * When the "write this guide" affordances render. Defaults to `editMode`,
	 * which keeps edit views clean until a reader turns wiki edit mode on.
	 */
	writeAffordances?: WikiWriteAffordanceMode
}
