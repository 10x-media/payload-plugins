import type { CollectionConfig, CollectionSlug, Payload, PayloadRequest } from 'payload'
import { currentDate } from '../core/clock'
import { isCollectionSlug } from '../core/collectionSlug'
import { DETACHED } from '../db/openTransaction'
import { storeCollection } from '../native/collections/storeCollection'
import type { ReadFailureKind } from '../surfacing/classifyError'
import type { LaneHealth, LaneOutcome } from '../surfacing/lanes'
import type { ConnectionOutcome, ProviderStatus } from './connectionState'

/** The provider status collection's slug, unless `providers.collection.status.slug` names another. */
export const PROVIDER_STATUS_SLUG = 'analytics-provider-status'

/** How long a read's success goes unwritten after the last one was, unless a failure came between. */
export const STATUS_SUCCESS_EVERY_MS = 15 * 60_000

/**
 * The last connection result of each provider document, one row per document under the document's
 * own id, written by reads and by the Test connection button.
 */
export const providerStatusCollection = (slug: string = PROVIDER_STATUS_SLUG): CollectionConfig =>
	storeCollection({
		slug,
		fields: [
			{ name: 'lastSuccessAt', type: 'date' },
			{ name: 'lastErrorAt', type: 'date' },
			{ name: 'errorKind', type: 'text' },
			{ name: 'errorDetail', type: 'text' },
			{ name: 'pausedUntil', type: 'date' },
		],
		indexes: [],
	})

/**
 * What a read that reached the source says about the connection; undefined for a read refused as
 * asked or held back by the plugin's own limits, which says nothing about it. A refused host keeps
 * no detail, which can name the address it resolved to.
 */
export const connectionOutcomeOf = (
	outcome: LaneOutcome,
	health: LaneHealth
): ConnectionOutcome | undefined => {
	if (outcome.ok) {
		return { ok: true }
	}
	const { failure, error } = outcome
	if (failure.kind === 'invalid_param' || failure.kind === 'rate_limited') {
		return undefined
	}
	return {
		ok: false,
		kind: failure.kind,
		...(!failure.hostRefused && error instanceof Error ? { detail: error.message } : {}),
		...(health.retryAfterMs ? { pausedForMs: health.retryAfterMs } : {}),
	}
}

/** A vendor's message is a sentence or two; a longer one is an HTML page or a stack. */
const DETAIL_MAX = 300

const READ_FAILURE_KINDS: readonly ReadFailureKind[] = [
	'invalid_param',
	'source_misconfigured',
	'unavailable',
	'rate_limited',
]

const isoOf = (value: unknown): string | undefined => {
	if (value instanceof Date) {
		return value.toISOString()
	}
	return typeof value === 'string' && value !== '' ? value : undefined
}

const statusOf = (row: Record<string, unknown>): ProviderStatus => {
	const lastSuccessAt = isoOf(row.lastSuccessAt)
	const lastErrorAt = isoOf(row.lastErrorAt)
	const pausedUntil = isoOf(row.pausedUntil)
	const errorKind = READ_FAILURE_KINDS.find((kind) => kind === row.errorKind)
	const errorDetail = typeof row.errorDetail === 'string' ? row.errorDetail : undefined
	return {
		...(lastSuccessAt ? { lastSuccessAt } : {}),
		...(lastErrorAt ? { lastErrorAt } : {}),
		...(errorKind ? { errorKind } : {}),
		...(errorDetail ? { errorDetail } : {}),
		...(pausedUntil ? { pausedUntil } : {}),
	}
}

export interface ProviderStatusStore {
	/**
	 * Writes what a read or a check told. `throttle` skips a success written less than
	 * {@link STATUS_SUCCESS_EVERY_MS} ago with no failure since, so reads cost no write each.
	 */
	record(docId: string, outcome: ConnectionOutcome, options?: { throttle?: boolean }): Promise<void>
	read(docId: string): Promise<ProviderStatus | undefined>
}

/** Deletes a provider document's row in `req`'s transaction, so the document takes it along. */
export const removeProviderStatus = async (
	req: PayloadRequest,
	slug: string,
	docId: string
): Promise<void> => {
	if (!isCollectionSlug(req.payload, slug)) {
		return
	}
	await req.payload.db.deleteMany({ collection: slug, where: { id: { equals: docId } }, req })
}

/**
 * The status rows of one instance, through `payload.db`. Each document's writes run one after
 * another, so a late success never lands over the failure that followed it.
 */
export const providerStatusStore = (
	payload: Payload,
	slug: string,
	options: { now?: () => Date } = {}
): ProviderStatusStore => {
	const now = options.now ?? currentDate
	const successWrittenAt = new Map<string, number>()
	const queues = new Map<string, Promise<void>>()

	const collection = (): CollectionSlug => {
		if (!isCollectionSlug(payload, slug)) {
			throw new Error(`analytics: the "${slug}" collection is not registered`)
		}
		return slug
	}

	const rowOf = async (id: string): Promise<Record<string, unknown> | undefined> => {
		const { docs } = await payload.db.find<Record<string, unknown>>({
			collection: collection(),
			where: { id: { equals: id } },
			limit: 1,
			pagination: false,
			req: DETACHED,
		})
		return docs[0]
	}

	const put = async (id: string, data: Record<string, unknown>): Promise<void> => {
		const update = () =>
			payload.db.updateOne({
				collection: collection(),
				id,
				data,
				req: DETACHED,
				returning: false,
			})
		if ((await rowOf(id)) !== undefined) {
			await update()
			return
		}
		try {
			await payload.db.create({
				collection: collection(),
				data: { ...data, id },
				req: DETACHED,
				returning: false,
			})
		} catch (err) {
			// Another instance created it first.
			if ((await rowOf(id)) === undefined) {
				throw err
			}
			await update()
		}
	}

	const dataOf = (outcome: ConnectionOutcome, at: Date): Record<string, unknown> =>
		outcome.ok
			? { lastSuccessAt: at.toISOString(), pausedUntil: null }
			: {
					lastErrorAt: at.toISOString(),
					errorKind: outcome.kind,
					errorDetail: outcome.detail ? outcome.detail.slice(0, DETAIL_MAX) : null,
					pausedUntil:
						outcome.pausedForMs && outcome.pausedForMs > 0
							? new Date(at.getTime() + outcome.pausedForMs).toISOString()
							: null,
				}

	return {
		record(docId, outcome, { throttle = false } = {}) {
			const at = now()
			if (outcome.ok) {
				const written = successWrittenAt.get(docId)
				if (throttle && written !== undefined && at.getTime() - written < STATUS_SUCCESS_EVERY_MS) {
					return Promise.resolve()
				}
				successWrittenAt.set(docId, at.getTime())
			} else {
				successWrittenAt.delete(docId)
			}
			const data = dataOf(outcome, at)
			const queued = (queues.get(docId) ?? Promise.resolve())
				.then(() => put(docId, data))
				.catch((err: unknown) => {
					// Unwritten, so the next success is written whatever the throttle says.
					successWrittenAt.delete(docId)
					throw err
				})
			const settled = queued.catch(() => {})
			queues.set(docId, settled)
			void settled.then(() => {
				if (queues.get(docId) === settled) {
					queues.delete(docId)
				}
			})
			return queued
		},

		async read(docId) {
			const row = await rowOf(docId)
			return row ? statusOf(row) : undefined
		},
	}
}
