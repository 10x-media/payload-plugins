import type { CollectionConfig, PayloadRequest } from 'payload'

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
	/**
	 * The banner shows a live countdown when the lock ends within this many
	 * milliseconds, and refreshes the page when it reaches zero.
	 * @default 10_800_000 (3 hours)
	 */
	countdownThresholdMs?: number
	/** The lock windows collection. */
	collection?: {
		/** @default 'content-locks' */
		slug?: string
		/** Who may read and manage lock windows. Defaults to any authenticated user. */
		access?: CollectionConfig['access']
		/** Last-word override of the generated collection config. */
		overrides?: (collection: CollectionConfig) => CollectionConfig
	}
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
export const DEFAULT_COUNTDOWN_THRESHOLD_MS = 3 * 60 * 60 * 1000
export const DEFAULT_ORDER = 1000

/** Options after defaults, in the serializable shape stored on `config.custom`. */
export type ResolvedOptions = {
	slug: string
	groups: LockGroup[]
	individualSelection: boolean
	exempt: string[]
	retryAfter: number | 'untilEnd'
	countdownThresholdMs: number
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
		countdownThresholdMs: options.countdownThresholdMs ?? DEFAULT_COUNTDOWN_THRESHOLD_MS,
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
