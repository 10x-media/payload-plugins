import type { PayloadRequest, TaskConfig } from 'payload'
import type { AnalyticsResult, AnalyticsRow } from '../core/contract'
import { supportsGranularity } from '../core/granularity'
import { getRuntime } from '../plugin/runtime'
import { METRIC_FIELDS, type SyncMetric } from './collection'

export const SYNC_TASK_SLUG = 'analytics-sync'

const DAY_MS = 86_400_000

export type SyncRow = { source: string; date: Date; syncedAt: Date } & Partial<
	Record<SyncMetric, number>
>

export interface SyncTaskOptions {
	cron: string
	lookbackDays: number
	collectionSlug: string
	adapterIds?: string[]
}

/**
 * Map one daily `AnalyticsRow` to a sync-collection doc: the row's UTC-day timestamp becomes
 * `date`, each present numeric metric is copied, absent metrics are omitted (stored null).
 * Returns null when the row has no usable timestamp, so a malformed row is skipped not written.
 */
export const toSyncRow = (source: string, row: AnalyticsRow, syncedAt: Date): SyncRow | null => {
	if (!row.timestamp) {
		return null
	}
	const date = new Date(row.timestamp)
	if (Number.isNaN(date.getTime())) {
		return null
	}
	const doc: SyncRow = { source, date, syncedAt }
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
			and: [{ source: { equals: row.source } }, { date: { equals: row.date.toISOString() } }],
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
 * daily metrics into the sync collection (one upserted row per source + day), reading
 * through the surfacing engine so the pull rides its queue / backoff / cache. Native is
 * excluded (its data already lives in the rollups collection); each provider runs in its
 * own try/catch so one failure does not abort the rest.
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
		for (const adapter of runtime.registry.all()) {
			if (adapter.id === 'native') {
				continue
			}
			if (opts.adapterIds && !opts.adapterIds.includes(adapter.id)) {
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
				result = await runtime.engine.read(adapter, { metrics, dateRange, granularity: 'day' })
			} catch (err) {
				failed++
				req.payload.logger.warn(
					`analytics sync: adapter "${adapter.id}" read failed: ${String(err)}`
				)
				continue
			}
			for (const row of result.rows) {
				const doc = toSyncRow(adapter.id, row, now)
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
		return { output: { synced, failed } }
	},
	schedule: [{ cron: opts.cron, queue: 'default' }],
})
