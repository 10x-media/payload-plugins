import type { PayloadRequest, TaskConfig } from 'payload'
import type { AnalyticsResult, AnalyticsRow } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import type { ScopesResolver } from '../core/options'
import { resolveScopeList } from '../core/scopeList'
import { getRuntime, resolveRegistryFor } from '../plugin/runtime'
import { METRIC_FIELDS, type SyncMetric } from './collection'

export const SYNC_TASK_SLUG = 'analytics-sync'

const DAY_MS = 86_400_000

export type SyncRow = { source: string; date: Date; syncedAt: Date; scope: string } & Partial<
	Record<SyncMetric, number>
>

export interface SyncTaskOptions {
	cron: string
	lookbackDays: number
	collectionSlug: string
	adapterIds?: string[]
	/** Tenant scopes to fan out over, in addition to the install-wide scope every run already covers. */
	scopes?: ScopesResolver
}

/**
 * Map one daily `AnalyticsRow` to a sync-collection doc: the row's UTC-day timestamp becomes
 * `date`, each present numeric metric is copied, absent metrics are omitted (stored null).
 * Returns null when the row has no usable timestamp, so a malformed row is skipped not written.
 */
export const toSyncRow = (
	source: string,
	row: AnalyticsRow,
	opts: { syncedAt: Date; scope?: string }
): SyncRow | null => {
	if (!row.timestamp) {
		return null
	}
	const date = new Date(row.timestamp)
	if (Number.isNaN(date.getTime())) {
		return null
	}
	const doc: SyncRow = { source, date, syncedAt: opts.syncedAt, scope: opts.scope ?? '' }
	for (const metric of METRIC_FIELDS) {
		const value = row.metrics[metric]
		if (typeof value === 'number') {
			doc[metric] = value
		}
	}
	return doc
}

const startOfUtcDay = (d: Date): Date =>
	new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

const upsertDailyRow = async (
	req: PayloadRequest,
	collectionSlug: string,
	row: SyncRow
): Promise<void> => {
	const existing = await req.payload.find({
		collection: collectionSlug as never,
		where: {
			and: [
				{ source: { equals: row.source } },
				{ date: { equals: row.date.toISOString() } },
				{ scope: { equals: row.scope } },
			],
		},
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	const found = existing.docs[0] as { id: string | number } | undefined
	if (found) {
		await req.payload.update({
			collection: collectionSlug as never,
			id: found.id,
			data: row as never,
			overrideAccess: true,
		})
		return
	}
	await req.payload.create({
		collection: collectionSlug as never,
		data: row as never,
		overrideAccess: true,
	})
}

/**
 * Opt-in Payload task that ETLs each configured provider adapter's last `lookbackDays` of
 * daily metrics into the sync collection (one upserted row per scope + source + day),
 * reading through the surfacing engine so the pull rides its queue / backoff / cache.
 * Native is excluded (its data already lives in the rollups collection); each provider
 * runs in its own try/catch so one failure does not abort the rest. With `scopes`
 * configured, the whole per-adapter pull runs once per tenant scope (plus the
 * install-wide scope) so a multi-tenant install syncs every tenant, not just the null one.
 */
export const syncTask = (
	opts: SyncTaskOptions
): TaskConfig<{ input: Record<string, never>; output: { synced: number; failed: number } }> => ({
	slug: SYNC_TASK_SLUG,
	handler: async ({ req }) => {
		const runtime = getRuntime(req.payload)
		if (!runtime) {
			return { output: { synced: 0, failed: 0 } }
		}
		const now = new Date()
		const dateRange = {
			start: new Date(startOfUtcDay(now).getTime() - (opts.lookbackDays - 1) * DAY_MS),
			end: now,
		}
		let synced = 0
		let failed = 0
		const scopeList = await resolveScopeList(opts.scopes, req.payload)
		for (const scope of scopeList) {
			const registry = await resolveRegistryFor(runtime, { payload: req.payload, req, scope })
			for (const adapter of registry.all()) {
				if (adapter.id === 'native') {
					continue
				}
				if (opts.adapterIds && !opts.adapterIds.includes(adapter.id)) {
					continue
				}
				// A shared config adapter that cannot narrow its query to one tenant would
				// otherwise return install-wide totals here, which then get stamped as this
				// scope's row; skip it for every tenant pass, same as the read path's gate.
				if (
					scope !== null &&
					runtime.configAdapterIds.has(adapter.id) &&
					!adapter.capabilities.scopedQueries
				) {
					continue
				}
				if (!adapter.isConfigured() || !supportsGranularity(adapter.capabilities, 'day')) {
					continue
				}
				const metrics = METRIC_FIELDS.filter((m) => adapter.capabilities.metrics.has(m))
				if (metrics.length === 0) {
					continue
				}
				let result: AnalyticsResult
				try {
					result = await runtime.engine.read(adapter, {
						metrics,
						dateRange,
						granularity: 'day',
						scope: scope ?? undefined,
					})
				} catch (err) {
					failed++
					req.payload.logger.warn(
						`analytics sync: adapter "${adapter.id}" read failed (scope "${scope ?? ''}"): ${String(err)}`
					)
					continue
				}
				if (result.meta.stale) {
					failed++
					req.payload.logger.warn(
						`analytics sync: adapter "${adapter.id}" read was stale-served, skipping sync (scope "${scope ?? ''}")`
					)
					continue
				}
				for (const row of result.rows) {
					const doc = toSyncRow(adapter.id, row, { syncedAt: now, scope: scope ?? '' })
					if (!doc) {
						continue
					}
					try {
						await upsertDailyRow(req, opts.collectionSlug, doc)
						synced++
					} catch (err) {
						failed++
						req.payload.logger.warn(
							`analytics sync: upsert for "${adapter.id}" on ${doc.date.toISOString()} failed: ${String(err)}`
						)
					}
				}
			}
		}
		return { output: { synced, failed } }
	},
	schedule: [{ cron: opts.cron, queue: 'default' }],
})
