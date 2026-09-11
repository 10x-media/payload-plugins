import type {
	CollectionSlug,
	GlobalSlug,
	PayloadComponent,
	PayloadRequest,
	SanitizedPermissions,
} from 'payload'

/** A label as Payload writes them: one string, or one per admin language. */
export type LocalizedLabel = Record<string, string> | string

/**
 * Panel width preset. `compact` suits a stack of settings rows, where a wider panel only adds
 * empty space to the right of every one of them; `wide` suits a list view or a long form.
 */
export type OverlayLayout = 'compact' | 'wide'

/**
 * Whether a navigation inside the panel is a history entry of its own. See
 * `SettingsOverlayConfig.history`.
 */
export type OverlayHistory = 'push' | 'replace'

/**
 * Server-side door on a whole overlay. Takes the request rather than a narrower set of
 * arguments so one project-level predicate can gate this panel and whatever else you gate.
 * Throwing denies (fail-closed) and logs.
 */
export type OverlayAccess = (args: {
	overlay: SettingsOverlayConfig
	req: PayloadRequest
}) => boolean | Promise<boolean>

/** Server-side door on a single rail row. Throwing denies (fail-closed) and logs. */
export type ItemAccess = (args: {
	item: SettingsOverlayItem
	req: PayloadRequest
}) => boolean | Promise<boolean>

/**
 * Resolves which document a collection item should open, making the collection behave
 * like a global: no list, straight to a document.
 *
 * Returning a string opens that document, `'create'` opens the create form, and `null`
 * falls back to the ordinary list. Resolved on every open rather than pinned into the
 * URL, because "the current tenant's document" changes with the tenant.
 */
export type ResolveDocID = (args: {
	item: CollectionItem
	req: PayloadRequest
}) => 'create' | Promise<'create' | null | string> | null | string

/** How a rail badge gets its value: fetched by the plugin, or published by the host. */
export type BadgeConfig =
	| {
			/** Reads `responseKey` off the JSON body returned by `endpoint`. */
			endpoint: string
			method?: 'GET' | 'POST'
			responseKey: string
			type: 'api'
	  }
	| {
			/** Counts documents in the item's own collection. */
			type: 'collection-count'
	  }
	| {
			/** Reads a value published by a host `BadgeProvider` under this slug. */
			slug: string
			type: 'provider'
	  }

export type SortableGroup = {
	/** `null` for the ungrouped block, which always renders first. */
	label: null | string
}

/**
 * A sort position. `undefined` means "leave where it was", which is what makes the
 * sort stable: only entries the function has an opinion about move.
 */
export type SortKey = number | string | undefined

export type SettingsSortConfig = {
	groups?: (group: SortableGroup, ctx: { locale: string }) => SortKey
	items?: (item: SettingsOverlayItem, group: SortableGroup, ctx: { locale: string }) => SortKey
}

type BaseItem = {
	/** Server-side door on this row. */
	access?: ItemAccess
	badge?: BadgeConfig
	/** Overrides the entity's own `admin.group` inside the rail. */
	group?: LocalizedLabel
	icon?: PayloadComponent
	/** Extra terms the rail's search box matches, beyond the label and slug. */
	keywords?: string[]
	label?: LocalizedLabel
	/** Sugar for the common case where a `sort.items` function would be overkill. */
	order?: number
	slug: string
}

export type CollectionItem = {
	/** Present means the item behaves like a global: no list, straight to a document. */
	resolveDocID?: ResolveDocID
	slug: CollectionSlug
	type: 'collection'
} & BaseItem

export type GlobalItem = {
	slug: GlobalSlug
	type: 'global'
} & BaseItem

export type LinkItem = {
	/** Relative to the admin route. Selecting the row closes the panel and navigates. */
	href: `/${string}`
	label: LocalizedLabel
	type: 'link'
} & BaseItem

/**
 * A registered admin view, mounted inside the panel by its key in `admin.components.views`.
 *
 * The view receives the page props it was written for, so it works unchanged. It has a URL of
 * its own, and `hideEntities` does not apply to it: the plugin never hides a view. Views that wrap themselves in `DefaultTemplate` need either the `settingsOverlayEmbed`
 * server prop (yours) or the `@10x-media/settings-overlay/embed` shim (somebody else's).
 */
export type ViewItem = {
	label: LocalizedLabel
	type: 'view'
	/** Key in `admin.components.views`, for example `auditLogs`. */
	viewKey: string
} & BaseItem

/**
 * A component that exists only inside the panel. No URL of its own, no page props.
 *
 * Rendered ahead of time with the rest of the admin, so opening it costs no round trip.
 * Set `lazy` when the component reads data and should not run on every page load.
 */
export type ComponentItem = {
	component: PayloadComponent
	label: LocalizedLabel
	/** @default false */
	lazy?: boolean
	type: 'component'
} & BaseItem

export type SettingsOverlayItem = CollectionItem | ComponentItem | GlobalItem | LinkItem | ViewItem

/** Replaceable pieces of the panel. Each has an exported props type; see `exports/client`. */
export type SettingsOverlayComponents = {
	/** The "nothing here" state. */
	Empty?: PayloadComponent
	/** Title, back, delete and close. */
	Header?: PayloadComponent
	/** The whole panel body. */
	Panel?: PayloadComponent
	/** The left rail in full. */
	Rail?: PayloadComponent
	/** One group heading plus its rows. */
	RailGroup?: PayloadComponent
	/** One rail row. */
	RailItem?: PayloadComponent
	/** The rail's search box. */
	Search?: PayloadComponent
}

export type SettingsOverlayConfig = {
	access?: OverlayAccess
	/** Whether the panel is reachable by URL. @default true */
	addressable?: boolean
	/**
	 * How the panel uses the browser's history.
	 *
	 * `'push'` makes every navigation an entry, as pages are: opening the panel, switching rows,
	 * opening a document, returning to its list, and closing the panel again. The back button walks
	 * all of it in reverse, so pressing it after a close reopens the panel where the reader left it.
	 * The list's own filters, search, sort and paging replace instead, which is what Payload's list
	 * does on a page, so the back button does not replay every keystroke.
	 *
	 * `'replace'` never adds an entry. The URL still names the panel, so a link to it can be sent and
	 * survives a reload, but the back button leaves the page, the way it does over one of Payload's
	 * own drawers.
	 *
	 * Has no effect when `addressable` is `false`. The history can only hold what the URL holds, and
	 * a panel kept out of the URL is invisible to the back button either way.
	 *
	 * @default 'push'
	 */
	history?: OverlayHistory
	/** Extra class beside `settings-overlay` and `settings-overlay--<id>`. */
	className?: string
	components?: SettingsOverlayComponents
	/**
	 * Hides every collection and global this overlay lists from the nav and from its own admin
	 * route, so the panel is the only way in. It sets `admin.hidden: true` on the entity, which is
	 * all it does. A function-valued `admin.hidden` the entity already had is not lost: it keeps
	 * deciding, per reader, whether the row shows in the panel.
	 *
	 * Off by default, because the panel is not a replacement for the collection's own views. It
	 * renders the list and the edit view in drawer mode, and Payload leaves several things out of
	 * that mode:
	 *
	 * - no trash tab, so a trashed document cannot be found from the panel (opening one directly
	 *   still offers restore and permanent delete);
	 * - no bulk delete or bulk edit, because the list's selection actions are not rendered;
	 * - no document tabs, so API, Versions and Live Preview are unreachable;
	 * - no copy-to-locale, and no duplicate into selected locales.
	 *
	 * Turn it on when the entity is genuinely settings-shaped and none of that applies. Leaving it
	 * off costs a nav entry and keeps the full views one click away.
	 *
	 * Hiding belongs to the entity rather than to the panel, so two overlays listing the same
	 * entity must agree on this flag; disagreeing is a boot error naming both.
	 *
	 * @default false
	 */
	hideEntities?: boolean
	/**
	 * Folds a collection list's own header into the pane header: Payload's list title is hidden
	 * (it repeats the pane title one line below it) and its Create button moves up beside Close.
	 * The collection's description and any after-header content stay where they are.
	 *
	 * Set `false` to leave Payload's list header exactly as it renders on a page.
	 *
	 * @default true
	 */
	mergeListHeader?: boolean
	icon?: PayloadComponent
	id: string
	items: SettingsOverlayItem[]
	/** @default 'compact' */
	layout?: OverlayLayout
	label: LocalizedLabel
	/** @default false */
	searchable?: boolean
	sort?: SettingsSortConfig
}

export type SettingsOverlayPluginOptions = {
	/** Applied to every overlay; each overlay may override them. */
	defaults?: Pick<
		SettingsOverlayConfig,
		| 'addressable'
		| 'components'
		| 'hideEntities'
		| 'history'
		| 'layout'
		| 'mergeListHeader'
		| 'searchable'
	>
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * How a `view` item, or a `component` item marked `lazy`, reaches the server when it is
	 * opened. Both render the same thing; they differ only in what the installation costs.
	 *
	 * `'widget'` needs nothing from you. The plugin registers one internal dashboard widget and
	 * rides Payload's built-in `render-widget`. The widget shows up in the dashboard's "Add
	 * widget" drawer, which readers see only while editing their dashboard.
	 *
	 * `'server-function'` registers no widget. In exchange you spread
	 * `settingsOverlayServerFunctions` into `handleServerFunctions` in your
	 * `app/(payload)/layout.tsx`. Payload has no config-level way to register a server function,
	 * so this is the only contract-backed route, and the only one that costs an edit.
	 *
	 * Neither applies when no overlay holds a lazy item.
	 *
	 * @default 'widget'
	 */
	lazyTransport?: 'server-function' | 'widget'
	overlays: SettingsOverlayConfig[]
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/settings-overlay/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOptionShape
}

/** Structural stand-in for `TranslationsOption`, kept here so types stay import-cycle free. */
type TranslationsOptionShape = {
	[locale: string]: Partial<Record<string, string>>
}

/**
 * An entity's own `admin.hidden` when it was declared as a function. Payload's semantics:
 * `true` means hidden from this user.
 */
export type HiddenPredicate = (args: { user: unknown }) => boolean

/** Keyed by slug. An entity with no entry never declared a function-valued `admin.hidden`. */
export type HiddenPredicates = {
	collections: Record<string, HiddenPredicate>
	globals: Record<string, HiddenPredicate>
}

/** One rail row, resolved for one reader. Labels are already translated. */
export type ManifestItem = {
	badge?: BadgeConfig
	/**
	 * For `collection` items whose `resolveDocID` says to open a document directly, or `'new'`
	 * for the create form. A resolver returning Payload's `'create'` is normalised to `'new'`
	 * here, which is the token the panel writes into the URL.
	 */
	directDocID?: 'new' | string
	/** Present for `link` items. */
	href?: string
	keywords?: string[]
	label: string
	slug: string
	type: SettingsOverlayItem['type']
}

export type ManifestGroup = {
	/** `null` for the ungrouped block, which renders first and is never collapsible. */
	label: null | string
	items: ManifestItem[]
	/** Whether the reader left this group expanded. Absent means expanded. */
	open?: boolean
}

/** What one reader may open in one overlay. Computed on the server, never assembled client-side. */
export type Manifest = {
	groups: ManifestGroup[]
	id: string
	label: string
}

/**
 * The closed panel's own properties, and nothing else. Item inventory reaches the browser
 * only through `Manifest`, already filtered by access.
 */
export type ClientOverlay = {
	addressable: boolean
	className?: string
	history: OverlayHistory
	id: string
	label: LocalizedLabel
	layout: OverlayLayout
	mergeListHeader: boolean
	searchable: boolean
}

/** Where the reader is pointed inside an overlay. */
export type Target = {
	/** A document id for a collection item, or `'new'` for the create form. */
	id?: string
	/** Item slug. Absent means "the first visible item". */
	item?: string
	/** The list's query while a collection list is shown. */
	query?: unknown
}

/**
 * What a component rendered inside the panel can learn about where it is.
 * `null` outside a panel. Read through `useSettingsOverlayEmbed()`.
 */
export type SettingsOverlayEmbed = {
	close: () => void
	/**
	 * Set when `resolveDocID` pointed this item straight at one document, so the panel shows a
	 * form where a list would be. Such an item behaves like a global: there is no list to go back
	 * to, and the document is not one of many.
	 */
	directDocID?: string
	/** For a collection item: the open document's id, or `'new'`. */
	docID?: string
	itemSlug: string
	itemType: SettingsOverlayItem['type']
	layout: OverlayLayout
	overlayId: string
	setTarget: (target: Target) => void
}

/** The server-side half of `SettingsOverlayEmbed`, handed to server components as a prop. */
export type SettingsOverlayEmbedServer = Omit<SettingsOverlayEmbed, 'close' | 'setTarget'>

/** Extra server props every in-panel component receives beside Payload's own. */
export type SettingsOverlayItemServerProps = {
	permissions: SanitizedPermissions
	req: PayloadRequest
	settingsOverlayEmbed: SettingsOverlayEmbedServer
}
