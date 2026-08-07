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

export type WikiListTriggerSlot = 'actions' | 'beforeListTable' | 'menu'
export type WikiEditTriggerSlot = 'beforeDocumentControls' | 'menu'
export type WikiGlobalTriggerSlot = 'beforeDocumentControls'

/**
 * Where the guide trigger renders on each surface; `false` disables the surface.
 * Globals have no `editMenuItems` slot in Payload, so only
 * `beforeDocumentControls` is offered there.
 */
export type WikiTriggersOptions = {
	/** Document edit views. Defaults to `beforeDocumentControls`. */
	edit?: false | WikiEditTriggerSlot
	/** Global edit views. Defaults to `beforeDocumentControls`. */
	global?: false | WikiGlobalTriggerSlot
	/** Collection list views. Defaults to `actions` (header, top right). */
	list?: false | WikiListTriggerSlot
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
}
