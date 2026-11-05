/**
 * Helpers predefined migrations call. Each one is a subpath,
 * `@10x-media/analytics/migrations/<name>`, exporting what `getPredefinedMigration` reads.
 */
export {
	deleteLegacyCache,
	deleteLegacySalts,
	dropLegacyNative,
	LEGACY_MONGO_COLLECTIONS,
	LEGACY_PRUNE_TASK,
	LEGACY_SALT_PREFIX,
	LEGACY_WARM_TASK,
	type LegacyDropReport,
} from '../migrations/legacy'
