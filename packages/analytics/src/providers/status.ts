import type { Payload } from 'payload'
import { currentDate } from '../core/clock'
import { isRecord } from '../core/values'
import { type ReadFailureKind, vendorAnswerOf } from '../surfacing/classifyError'
import type { LaneHealth, LaneOutcome } from '../surfacing/lanes'
import type { ConnectionOutcome, ProviderStatus } from './connectionState'

/** How long a read's success goes unwritten after the last one was, unless a failure came between. */
export const STATUS_SUCCESS_EVERY_MS = 15 * 60_000

/** The `payload.kv` key of one provider document's last connection result. */
export const providerStatusKey = (docId: string): string => `analytics:provider-status:${docId}`

/**
 * What a read that reached the source says about the connection; undefined for a read refused as
 * asked or held back by the plugin's own limits, which says nothing about it. A refused host keeps
 * no detail, which can name the address it resolved to; only the vendor's own answer is kept as
 * detail (`vendorAnswerOf`).
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
	const vendorAnswer = failure.hostRefused ? undefined : vendorAnswerOf(error)
	return {
		ok: false,
		kind: failure.kind,
		...(vendorAnswer === undefined ? {} : { detail: vendorAnswer }),
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
	/** The rows of `docIds` that exist, keyed by document id, in one read. */
	readMany(docIds: readonly string[]): Promise<Map<string, ProviderStatus>>
	/**
	 * Deletes a document's row, outside any transaction, after its writes already queued: on its
	 * delete, and on a save that changes how it connects, whose last result was about the old setup.
	 */
	forget(docId: string): Promise<void>
	/** Waits for every write already queued, for a runtime that closes or a test that settles. */
	idle(): Promise<void>
}

/**
 * Each provider document's last connection result in `payload.kv`, outside any transaction. Each
 * document's writes run one after another, so a late success never lands over the failure that
 * followed it.
 */
export const providerStatusStore = (
	payload: Payload,
	options: { now?: () => Date } = {}
): ProviderStatusStore => {
	const now = options.now ?? currentDate
	const successWrittenAt = new Map<string, number>()
	const queues = new Map<string, Promise<void>>()

	const rowOf = async (id: string): Promise<Record<string, unknown> | undefined> => {
		const row: unknown = await payload.kv.get(providerStatusKey(id))
		return isRecord(row) ? row : undefined
	}

	/** Merges `data` over the stored row, so a success keeps the last failure beside it. */
	const put = async (id: string, data: Record<string, unknown>): Promise<void> => {
		await payload.kv.set(providerStatusKey(id), { ...(await rowOf(id)), ...data })
	}

	/** Runs `work` after the document's writes already queued, so a late one never lands over it. */
	const enqueue = (docId: string, work: () => Promise<void>): Promise<void> => {
		const queued = (queues.get(docId) ?? Promise.resolve()).then(work)
		const settled = queued.catch(() => {})
		queues.set(docId, settled)
		void settled.then(() => {
			if (queues.get(docId) === settled) {
				queues.delete(docId)
			}
		})
		return queued
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
			return enqueue(docId, () => put(docId, data)).catch((err: unknown) => {
				// Unwritten, so the next success is written whatever the throttle says.
				successWrittenAt.delete(docId)
				throw err
			})
		},

		async readMany(docIds) {
			// One read per document: `payload.kv` has no batch read, and a scope holds a few.
			const entries = await Promise.all(
				docIds.map(async (id): Promise<[string, ProviderStatus] | undefined> => {
					const row = await rowOf(id)
					return row ? [id, statusOf(row)] : undefined
				})
			)
			return new Map(entries.filter((entry) => entry !== undefined))
		},

		forget(docId) {
			successWrittenAt.delete(docId)
			return enqueue(docId, () => payload.kv.delete(providerStatusKey(docId)))
		},

		async idle() {
			await Promise.all(queues.values())
		},

		async read(docId) {
			const row = await rowOf(docId)
			return row ? statusOf(row) : undefined
		},
	}
}
