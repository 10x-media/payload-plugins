import type { CollectionConfig, DateField, PayloadRequest } from 'payload'
import type { LockAccessOption } from './collection/access'
import type { ContentLockJobsOptions } from './jobs/registerJobs'

import type { ContentLockEditorFeaturesOption } from './lexical/editor'
import type { CustomTarget, PathMatch } from './state/customTargets'
import type { LockGroup } from './state/types'
import type { TranslationsOption } from './translations'

/** A named set of collections, globals and custom targets that can be frozen together. */
export type ContentLockGroup = {
	/** Stable identifier stored on lock windows as `group:<key>`. Renaming it orphans old windows. */
	key: string
	/** Label shown in the targets select and the banner. A string or a per-language map. */
	label: string | Record<string, string>
	collections?: string[]
	globals?: string[]
	/** Keys of declared `customTargets`. */
	custom?: string[]
}

/** Where a custom target lives in the admin: a path below the admin route. */
export type ContentLockCustomTargetPath = string | { path: string; match?: PathMatch }

/**
 * Something a window can lock that the config does not describe: a custom
 * view, an integration, a sync. The plugin blocks no writes for it; project
 * code checks it with `isContentLocked(payload, { custom: key })` or
 * `useContentLock().isLocked({ type: 'custom', slug: key })`. The string
 * shorthand declares a key labelled by itself.
 */
export type ContentLockCustomTarget =
	| string
	| {
			key: string
			/** Shown in the window form and the banner. Defaults to the key. */
			label?: string | Record<string, string>
			/**
			 * Admin pages that stand for this target, so the banner there shows
			 * only the windows covering it. A path covers itself and everything
			 * below (`match: 'prefix'`, the default) or only itself
			 * (`match: 'exact'`); the query string never counts.
			 */
			path?: ContentLockCustomTargetPath | ContentLockCustomTargetPath[]
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
	/** Custom targets a window can lock besides collections and globals. */
	customTargets?: ContentLockCustomTarget[]
	/**
	 * Escape hatch next to the groups: lets a window freeze individual
	 * collections and globals by slug, in two fields of their own. Pass an
	 * object with `access` to show those fields only to some users.
	 * @default false
	 */
	individualSelection?: boolean | { access?: (args: { req: PayloadRequest }) => boolean }
	/**
	 * Collection and global slugs never frozen. The plugin's own collection and
	 * Payload's system collections are always exempt, and so is any collection
	 * or global whose config sets `custom: { contentLock: { exempt: true } }`.
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
		 * Who may read and manage lock windows. Per operation, or one function
		 * for create, update and delete (read then stays with any signed-in
		 * user). Defaults to any signed-in user. `update` never reaches an ended
		 * window: the plugin adds that rule on top, after `overrides` too.
		 */
		access?: LockAccessOption
		/**
		 * Last-word override of the generated collection config. Ended windows
		 * stay read-only even when it replaces `access`: the plugin applies that
		 * rule to the result.
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
	customTargets: CustomTarget[]
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
			custom: group.custom ?? [],
		})),
		customTargets: resolveCustomTargets(options.customTargets),
		individualSelection: Boolean(options.individualSelection),
		exempt: [...new Set([slug, ...SYSTEM_EXEMPT, ...(options.exempt ?? [])])],
		retryAfter: options.retryAfter ?? DEFAULT_RETRY_AFTER,
		...(options.editor?.converters ? { editorConverters: options.editor.converters } : {}),
		localeMap: options.localeMap ?? {},
	}
}

const resolveCustomTargets = (targets: ContentLockCustomTarget[] = []): CustomTarget[] => {
	const resolved: CustomTarget[] = []
	for (const target of targets) {
		const entry = typeof target === 'string' ? { key: target } : target
		const key = entry.key.replace(/^custom:/, '').trim()
		if (!key || resolved.some((known) => known.key === key)) {
			continue
		}
		const paths =
			entry.path === undefined ? [] : Array.isArray(entry.path) ? entry.path : [entry.path]
		resolved.push({
			key,
			label: entry.label ?? key,
			paths: paths.map((path) =>
				typeof path === 'string'
					? { path, match: 'prefix' as const }
					: { path: path.path, match: path.match ?? 'prefix' }
			),
		})
	}
	return resolved
}

export const CUSTOM_KEY = '@10x-media/content-lock'

/** The resolved options on the sanitized config, or `undefined` when the plugin did not run (disabled or not installed). */
export const storedOptionsOf = (config: {
	custom?: Record<string, unknown>
}): ResolvedOptions | undefined => config.custom?.[CUSTOM_KEY] as ResolvedOptions | undefined

/** Read the resolved options the plugin stored on the sanitized config. */
export const optionsFromConfig = (config: {
	custom?: Record<string, unknown>
}): ResolvedOptions => {
	const stored = storedOptionsOf(config)
	if (!stored) {
		throw new Error('[content-lock] plugin options not found on config.custom')
	}
	return stored
}
