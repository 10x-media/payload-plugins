import type { LexicalEditorProps } from '@payloadcms/richtext-lexical'
import type {
	Access,
	AdminViewServerProps,
	Block,
	CollectionConfig,
	PayloadComponent,
	PayloadRequest,
	Tab,
	TypedLocale,
} from 'payload'

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
	/** Available in nested editors (a callout body). Inline blocks default to true, blocks to false. */
	nestable?: boolean
}

/**
 * One lexical feature, exactly as `lexicalEditor` takes them. Derived from its
 * own props rather than spelled out, because the feature type is generic over
 * three prop types this plugin has no business naming.
 */
export type WikiEditorFeature = Extract<
	NonNullable<LexicalEditorProps['features']>,
	readonly unknown[]
>[number]

/**
 * Lexical features added to the wiki editor, for the extension a block cannot
 * express: a custom node, a toolbar item, a keyboard shortcut.
 *
 * The array form appends to the plugin's own features, which is what almost
 * every project wants. The function form is handed those same features as
 * `defaultFeatures` and returns the whole list, so it can also reorder or drop
 * one; dropping `wikiGuideLink` or the blocks feature takes the guide links or
 * the callouts with it, which is the caller's to decide and the caller's to
 * live with.
 */
export type WikiEditorFeaturesOption =
	| ((args: { defaultFeatures: WikiEditorFeature[]; nested: boolean }) => WikiEditorFeature[])
	| WikiEditorFeature[]

/** Extensions to the plugin's self-contained editor. */
export type WikiEditorOptions = {
	blocks?: WikiEditorBlockOption[]
	/** Import-map path of a client module exporting a `JSXConvertersFunction`. */
	converters?: string
	/** Lexical features beside the plugin's own. See {@link WikiEditorFeaturesOption}. */
	features?: WikiEditorFeaturesOption
	inlineBlocks?: WikiEditorBlockOption[]
}

/** One label, or one per admin language: `'Dashboard'` or `{ de: '…', en: '…' }`. */
export type WikiCustomTargetLabel = Record<string, string> | string

/**
 * A surface the plugin cannot derive from the config: a view registered through
 * `admin.components.views`, a panel inside one, a report, anything a project
 * renders itself and wants a guide attached to.
 *
 * The key is a bare slug of the project's choosing (`dashboard`,
 * `dashboard.attention`). The plugin namespaces it to `custom:<key>` on the way
 * in and out, so it can never collide with a collection, global, block, or
 * field target, and so a project never types the namespace. The string
 * shorthand declares a target labelled by its own key.
 */
export type WikiCustomTargetOption =
	| string
	| {
			/** Bare key, e.g. `dashboard`. A leading `custom:` is stripped. */
			key: string
			/** Shown in the target picker and on the "Covers" chips. Defaults to the key. */
			label?: WikiCustomTargetLabel
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

/**
 * Which target kinds the "Covers" chips show on the wiki index and the guide
 * pages. Field targets are never chipped: a guide written about a form attaches
 * to enough of them to drown out the entities beside them.
 */
export type WikiChipsOptions = {
	/**
	 * Chip the blocks a guide covers. Defaults to `true`. A guide attached to a
	 * dozen blocks chips a dozen times, and a block whose label is a function
	 * chips its slug, so a project can leave blocks out and keep the collections
	 * and globals a reader navigates by.
	 */
	blocks?: boolean
}

/** List-view slot the guides band renders in. */
export type WikiListBandSlot = 'afterList' | 'afterListTable' | 'beforeList' | 'beforeListTable'

/** The guides band on collection list views. */
export type WikiListBandOptions = {
	/** Which list slot to render in. Defaults to `afterListTable`. */
	slot?: WikiListBandSlot
}

/**
 * A slot on the wiki index view (`/admin/wiki`).
 *
 * - `beforeControls`: the header actions row, ahead of the edit mode toggle and
 *   the create button.
 * - `beforeTable`: between the search controls and the guide list.
 * - `afterTable`: below the guide list.
 *
 * Named after what the reader sees on this view rather than after Payload's
 * list slots, because the wiki index has one header row, one control bar, and
 * one list, where a collection list has four injection points around a table.
 */
export type WikiViewSlot = 'afterTable' | 'beforeControls' | 'beforeTable'

/**
 * Consumer components on the wiki index, one array per slot, exactly as a
 * collection's `admin.components` takes them: import-map paths, optionally with
 * their own `clientProps` and `serverProps`. Every entry in a slot renders in
 * array order.
 *
 * Slot components are not reachable by Payload's import map walk, which only
 * traverses the config shapes it knows, so the plugin registers each one under
 * `admin.dependencies`. Run `payload generate:importmap` after adding one.
 */
export type WikiViewComponents = {
	/** Below the guide list. */
	afterTable?: PayloadComponent[]
	/** The header actions row, before the edit mode toggle and the create button. */
	beforeControls?: PayloadComponent[]
	/** Between the search controls and the guide list. */
	beforeTable?: PayloadComponent[]
}

/** The wiki index and guide views, and what a project adds to the index. */
export type WikiViewOptions = {
	/** Consumer components per index slot. See {@link WikiViewComponents}. */
	components?: WikiViewComponents
}

/**
 * Client props every slot component receives, on top of whatever the entry
 * declares for itself. A client component gets these and nothing else.
 */
export type WikiViewSlotClientProps = {
	/** The reader's evaluated create permission on the guide collection. */
	canCreate: boolean
	/** Published guides the reader can see, before search and filters. */
	guideCount: number
	/** The slot this instance renders in, for a component wired into several. */
	slot: WikiViewSlot
	/** Admin-prefixed wiki index URL, e.g. `/admin/wiki`. */
	wikiPath: string
}

/**
 * Server props a slot component receives in addition to
 * {@link WikiViewSlotClientProps} when it is a server component. `locale` is the
 * content locale the guides on screen were loaded in, undefined when the config
 * is not localized.
 */
export type WikiViewSlotServerProps = Pick<
	AdminViewServerProps,
	'i18n' | 'params' | 'payload' | 'searchParams'
> & {
	locale: TypedLocale | undefined
	req: PayloadRequest
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

/**
 * Receives the collection exactly as the plugin built it and returns the one
 * Payload registers. Nothing is merged afterwards, so the plugin's own slug,
 * endpoints, access, and target fields are yours to keep or break.
 */
export type WikiCollectionOverride = (collection: CollectionConfig) => CollectionConfig

/**
 * Two ways into the guide pages collection, meant to be reached for in order.
 *
 * `tabs` is the one most projects want: guide authoring is already organized
 * into tabs, so extra editorial fields belong in tabs of their own rather than
 * loose at the end of the form. `collection` is the escape hatch for everything
 * else (hooks, sidebar fields, admin components, access).
 */
export type WikiPagesOverride = {
	/**
	 * Tabs appended after the plugin's own **Guide** and **Targets** tabs. Named
	 * tabs nest their fields under the tab name, unnamed tabs write theirs at the
	 * document root; either is fine, as long as no field collides with the
	 * plugin's own (`title`, `summary`, `content`, `target*`, `slug`, `featured`,
	 * `featuredOrder`).
	 */
	tabs?: Tab[]
	/** Applied last, after {@link WikiPagesOverride.tabs} has been appended. */
	collection?: WikiCollectionOverride
}

/**
 * Overrides for the two collections the plugin registers. Both run after the
 * collection is fully built, which means after the target fields have been
 * populated from the walked config.
 */
export type WikiOverridesOptions = {
	/** The wiki media upload collection. */
	media?: WikiCollectionOverride
	/** The guide pages collection. */
	pages?: WikiPagesOverride
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
	/** What the "Covers" chips show. See {@link WikiChipsOptions}. */
	chips?: WikiChipsOptions
	/**
	 * Surfaces the config does not describe, so guides can be attached to them
	 * too. Declaring any adds a fifth target list to the guide pages collection;
	 * declaring none leaves the collection exactly as it was. See
	 * {@link WikiCustomTargetOption}.
	 */
	customTargets?: WikiCustomTargetOption[]
	/** Extensions to the wiki editor: blocks, inline blocks, features, converters. */
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
	 * Reshape the collections the plugin registers. See
	 * {@link WikiOverridesOptions}.
	 */
	overrides?: WikiOverridesOptions
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
	/**
	 * The `/wiki` browsing and reading views. `false` skips registering them,
	 * `true` (the default) registers them as the plugin ships them, and an object
	 * registers them with your own components in the index slots. See
	 * {@link WikiViewOptions}.
	 */
	wikiView?: boolean | WikiViewOptions
	/**
	 * When the "write this guide" affordances render. Defaults to `editMode`,
	 * which keeps edit views clean until a reader turns wiki edit mode on.
	 */
	writeAffordances?: WikiWriteAffordanceMode
}
