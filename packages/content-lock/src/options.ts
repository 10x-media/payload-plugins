import type { CollectionConfig, DateField, PayloadRequest } from 'payload'
import type { ContentLockJobsOptions } from './jobs/registerJobs'

import type { ContentLockEditorFeaturesOption } from './lexical/editor'
import type { LockGroup } from './state/types'
import type { TranslationsOption } from './translations'

/** A named set of collections and globals that can be frozen together. */
export type ContentLockGroup = {
	/** Stable identifier stored on lock windows as `group:<key>`. Renaming it orphans old windows. */
	key: string
	/** Label shown in the targets select and the banner. A string or a per-language map. */
	label: string | Record<string, string>
	collections?: string[]
	globals?: string[]
}

export type ContentLockPluginOptions = {
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Plugin order. High by default so the access wrapper sees every other
	 * plugin's final access functions (multi-tenant runs at 100).
	 * @default 1000
	 */
	order?: number
	/** Groups offered by a "selected" window's targets. */
	groups?: ContentLockGroup[]
	/**
	 * Escape hatch next to the groups: lets a window freeze individual
	 * collections and globals by slug, in two fields of their own. Pass an
	 * object with `access` to show those fields only to some users.
	 * @default false
	 */
	individualSelection?: boolean | { access?: (args: { req: PayloadRequest }) => boolean }
	/**
	 * Collection and global slugs never frozen. The plugin's own collection and
	 * Payload's system collections are always exempt.
	 */
	exempt?: string[]
	/**
	 * `Retry-After` seconds on blocked requests, or `'untilEnd'` for the seconds
	 * until the lock's known end (3600 when the end is manual).
	 * @default 3600
	 */
	retryAfter?: number | 'untilEnd'
	/** The lock windows collection. */
	collection?: {
		/** @default 'content-locks' */
		slug?: string
		/**
		 * Who may read and manage lock windows. Defaults to any authenticated
		 * user. Ended windows stay read-only whatever `update` says: the plugin
		 * narrows it to windows that have not ended.
		 */
		access?: CollectionConfig['access']
		/**
		 * Last-word override of the generated collection config. It can replace
		 * `access` wholesale, dropping the plugin's read-only rule for ended
		 * windows; when it does, fold `notEndedWhere(new Date())` (exported from
		 * the package) into the new `update`. The server still refuses changes to
		 * an ended window either way.
		 */
		overrides?: (collection: CollectionConfig) => CollectionConfig
	}
	/**
	 * Time zone picker next to the window's dates (announce, start, end), so an
	 * author sets "22:00 Europe/Berlin" explicitly instead of in whatever zone
	 * their browser is in, and colleagues opening the window see the same
	 * wall-clock time. Dates are still stored as UTC instants; each date gains a
	 * sibling `<name>_tz` field. `true` uses the config's `admin.timezones`;
	 * pass Payload's date timezone config to narrow the zones or require one.
	 * The banner always shows the viewer's local time.
	 * @default true
	 */
	timezone?: boolean | Exclude<DateField['timezone'], undefined>
	/**
	 * Maps admin UI languages (`i18n.language`) to content locales, for projects
	 * whose two axes use different keys. A viewer's banner messages load in their
	 * admin language through this map, the language itself when it is a content
	 * locale, then the default locale.
	 */
	localeMap?: Record<string, string>
	/** Extensions to the banner message editor and its rendering. */
	editor?: {
		/**
		 * Lexical features beside the plugin's own (paragraph, bold, italic,
		 * link, lock value tokens). An array appends; a function gets the
		 * plugin's list as `defaultFeatures` and returns the whole list.
		 */
		features?: ContentLockEditorFeaturesOption
		/**
		 * Import-map path of a module exporting a `JSXConvertersFunction`, for
		 * nodes the added features bring. It receives the plugin's converters as
		 * `defaultConverters`. Rendered on the server, in the admin banner.
		 */
		converters?: string
	}
	/**
	 * Integration with `@10x-media/jobs`, on when that plugin is installed. A
	 * lock on everything pauses every queue; a partial lock keeps them running
	 * (or pauses the `queues` listed). A job a lock stops mid-run fails cleanly,
	 * or goes back to the queue until the lock ends when it opted into
	 * `deferOnInterrupt`. Jobs that should skip locked work up front can check
	 * `isContentLocked`. `false` turns it off.
	 */
	jobs?: false | ContentLockJobsOptions
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/content-lock/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

/** Payload's own collections that a lock must never freeze. */
export const SYSTEM_EXEMPT = [
	'payload-preferences',
	'payload-locked-documents',
	'payload-jobs',
	'payload-kv',
	'payload-migrations',
] as const

export const DEFAULT_SLUG = 'content-locks'
export const DEFAULT_RETRY_AFTER = 3600
export const DEFAULT_ORDER = 1000

/** Options after defaults, in the serializable shape stored on `config.custom`. */
export type ResolvedOptions = {
	slug: string
	groups: LockGroup[]
	individualSelection: boolean
	exempt: string[]
	retryAfter: number | 'untilEnd'
	/** Import-map path of the project's banner converters, if any. */
	editorConverters?: string
	localeMap: Record<string, string>
}

export const resolveOptions = (options: ContentLockPluginOptions): ResolvedOptions => {
	const slug = options.collection?.slug ?? DEFAULT_SLUG
	return {
		slug,
		groups: (options.groups ?? []).map((group) => ({
			key: group.key,
			label: group.label,
			collections: group.collections ?? [],
			globals: group.globals ?? [],
		})),
		individualSelection: Boolean(options.individualSelection),
		exempt: [...new Set([slug, ...SYSTEM_EXEMPT, ...(options.exempt ?? [])])],
		retryAfter: options.retryAfter ?? DEFAULT_RETRY_AFTER,
		...(options.editor?.converters ? { editorConverters: options.editor.converters } : {}),
		localeMap: options.localeMap ?? {},
	}
}

export const CUSTOM_KEY = '@10x-media/content-lock'

/** Read the resolved options the plugin stored on the sanitized config. */
export const optionsFromConfig = (config: {
	custom?: Record<string, unknown>
}): ResolvedOptions => {
	const stored = config.custom?.[CUSTOM_KEY]
	if (!stored) {
		throw new Error('[content-lock] plugin options not found on config.custom')
	}
	return stored as ResolvedOptions
}
