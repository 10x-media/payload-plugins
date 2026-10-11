import { valueAt } from './values'

/**
 * An option the plugin no longer accepts. `released` marks a path a published beta took, which the
 * upgrade guide lists; the rest are names only the pre-release tree used.
 */
export type LegacyOption =
	| { path: string; replacement: string; released: true; removedIn: string }
	| { path: string; replacement: string; released: false }

/** The upgrade guide a released option's error links to. */
export const UPGRADE_GUIDE_URL = 'https://docs.10xmedia.de/analytics/upgrading#removed-options'

const BETA_12 = '1.0.0-beta.12'

/**
 * Every option path the plugin no longer accepts: a present one fails the boot rather than being
 * read under its new name. An entry belongs here the moment an option is renamed or removed.
 */
export const LEGACY_OPTIONS: readonly LegacyOption[] = [
	{ path: 'scopeResolver', replacement: 'scope.resolve', released: true, removedIn: BETA_12 },
	{
		path: 'scopes',
		replacement:
			'scope.list for the scopes the cron jobs run over, scope.label for the view caption',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'access.platformRead',
		replacement: 'access.crossScope (a function grants all three cross-scope gates)',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'access.scopes',
		replacement:
			'access.crossScope: { named, aggregate, unscopedSource }, where unscopedSource is the old platformAdapter gate',
		released: false,
	},
	{
		path: 'capture.consent',
		replacement:
			"capture.gate: 'all', 'off', a list of slots, or ({ slot, adapterId, kind }) => boolean. ({ kind }) => kind !== 'native' reproduces the old default",
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'sync.collectionSlug',
		replacement: 'sync.collection.slug',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'sync.hidden',
		replacement: 'sync.collection.hidden',
		released: true,
		removedIn: BETA_12,
	},
	{ path: 'sync.overrides', replacement: 'sync.collection.overrides', released: false },
	{
		path: 'sync.cron',
		replacement: 'jobs.tasks.sync.cron, beside the queue it runs on',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'cache.warm.cron',
		replacement:
			'jobs.tasks.warm.cron, beside the queue it runs on; cache.warm keeps windowHours and maxReads',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'goals.collection.enabled',
		replacement: 'goals.collection: false to leave the collection off; an object turns it on',
		released: true,
		removedIn: BETA_12,
	},
	{ path: 'view.countryFlags', replacement: 'countryFlags', released: false },
	{ path: 'reportingCurrency', replacement: 'revenue.currency', released: false },
	{ path: 'convertCurrency', replacement: 'revenue.convert', released: false },
	{
		path: 'revenue.enabled',
		replacement: 'revenue: true or revenue: false; an object turns revenue on',
		released: false,
	},
	{
		path: 'revenue.wire',
		replacement: "revenue.browserAmounts: 'fixed', 'none' or 'trust'",
		released: false,
	},
	{
		path: 'providers.collection.hosts',
		replacement: 'providers.hosts, which serves the collection and providers.resolve alike',
		released: false,
	},
]

/** The entries the upgrade guide lists: the paths a published beta accepted. */
export const UPGRADE_GUIDE_OPTIONS: readonly LegacyOption[] = LEGACY_OPTIONS.filter(
	(entry) => entry.released
)

/**
 * Every `native()` option the adapter no longer accepts, by its path inside the adapter's options:
 * the retention windows of the rollup engine it replaced.
 */
export const LEGACY_NATIVE_OPTIONS: readonly LegacyOption[] = [
	{
		path: 'retentionDays',
		replacement: 'retention.rawDays, how many days of raw hits are kept and read',
		released: true,
		removedIn: BETA_12,
	},
	{
		path: 'rollupRetentionDays',
		replacement:
			'retention.aggregateDays for the daily totals that replaced rollups, which are kept for every day unless it is set',
		released: true,
		removedIn: BETA_12,
	},
]

/** The legacy options a config still carries, in table order. */
export const legacyOptionsIn = (
	options: unknown,
	legacy: readonly LegacyOption[] = LEGACY_OPTIONS
): LegacyOption[] => legacy.filter((entry) => valueAt(options, entry.path) !== undefined)

const described = (entry: LegacyOption, owner: string): string => {
	const named = `${owner}${entry.path}`
	return entry.released
		? `${named} was removed in ${entry.removedIn}, use ${entry.replacement}`
		: `${named} is not an option, use ${entry.replacement}`
}

/**
 * Fails the boot for options carrying any path the plugin no longer accepts: the plugin's own by
 * default, or another table's (`native()`'s) with `owner` naming whose options they are.
 */
export const assertNoLegacyOptions = (
	options: unknown,
	table: { legacy: readonly LegacyOption[]; owner: string } = { legacy: LEGACY_OPTIONS, owner: '' }
): void => {
	const found = legacyOptionsIn(options, table.legacy)
	if (found.length === 0) {
		return
	}
	const named = found.map((entry) => described(entry, table.owner)).join('; ')
	const guide = found.some((entry) => entry.released) ? `. Upgrade guide: ${UPGRADE_GUIDE_URL}` : ''
	throw new Error(`analytics: ${named}${guide}`)
}
