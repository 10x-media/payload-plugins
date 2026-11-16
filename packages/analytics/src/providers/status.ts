import type { Payload } from 'payload'
import { currentDate } from '../core/clock'
import { isUnknownSite } from '../core/sourceErrors'
import { isRecord } from '../core/values'
import { type ReadFailureKind, vendorAnswerOf } from '../surfacing/classifyError'
import type { LaneHealth, LaneOutcome } from '../surfacing/lanes'
import {
	type ConnectionOutcome,
	connectionFailureReasonOf,
	connectionStateOf,
	type ProviderStatus,
} from './connectionState'

/**
 * How long the rows a scope's reads look up (`readMany`) are answered from this instance's memory;
 * its own writes and forgets clear them at once, another instance's show this much later.
 */
export const STATUS_MEMO_MS = 5_000

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
		...(isUnknownSite(error) ? { reason: 'unknownSite' } : {}),
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
	const errorReason = connectionFailureReasonOf(row.errorReason)
	const errorDetail = typeof row.errorDetail === 'string' ? row.errorDetail : undefined
	return {
		...(lastSuccessAt ? { lastSuccessAt } : {}),
		...(lastErrorAt ? { lastErrorAt } : {}),
		...(errorKind ? { errorKind } : {}),
		...(errorReason ? { errorReason } : {}),
		...(errorDetail ? { errorDetail } : {}),
		...(pausedUntil ? { pausedUntil } : {}),
	}
}

export interface ProviderStatusStore {
	/**
	 * Writes what a read or a check told. `throttle` skips a success written less than
	 * {@link STATUS_SUCCESS_EVERY_MS} ago with no failure since, so reads cost no write each.
	 * `version` is the saved version of the document the outcome is about.
	 */
	record(
		docId: string,
		outcome: ConnectionOutcome,
		options?: { throttle?: boolean; version?: string }
	): Promise<void>
	/**
	 * The document's row; none when it is about another saved version than `version`, which a read
	 * of the settings before a save can write after the save.
	 */
	read(docId: string, version?: string): Promise<ProviderStatus | undefined>
	/** The rows of `docIds` that exist and are about the version `versionOf` names, keyed by id. */
	readMany(
		docIds: readonly string[],
		versionOf?: (docId: string) => string | undefined
	): Promise<Map<string, ProviderStatus>>
	/**
	 * Deletes a document's row, outside any transaction, after its writes already queued: on its
	 * delete, and on a save that changes how it connects, whose last result was about the old setup.
	 */
	forget(docId: string): Promise<void>
	/**
	 * Moves a row about the saved version `from` to `to`, after its writes already queued: a save
	 * that leaves how the document connects as it was keeps its last result.
	 */
	carry(docId: string, from: string, to: string): Promise<void>
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
	const memo = new Map<
		string,
		{ row: Promise<Record<string, unknown> | undefined>; until: number }
	>()

	const rowOf = async (id: string): Promise<Record<string, unknown> | undefined> => {
		const row: unknown = await payload.kv.get(providerStatusKey(id))
		return isRecord(row) ? row : undefined
	}

	/**
	 * A row this instance reads, which another instance may have written: none when it is about
	 * another saved version, and one that no longer says the source works lets this instance's next
	 * success through its throttle.
	 */
	const seen = (
		id: string,
		row: Record<string, unknown> | undefined,
		version: string | undefined
	): ProviderStatus | undefined => {
		const about = typeof row?.version === 'string' ? row.version : undefined
		const current = version === undefined || about === undefined || about === version
		const status = row && current ? statusOf(row) : undefined
		if (!status || connectionStateOf(status) !== 'works') {
			successWrittenAt.delete(id)
		}
		return status
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
					errorReason: outcome.reason ?? null,
					errorDetail: outcome.detail ? outcome.detail.slice(0, DETAIL_MAX) : null,
					pausedUntil:
						outcome.pausedForMs && outcome.pausedForMs > 0
							? new Date(at.getTime() + outcome.pausedForMs).toISOString()
							: null,
				}

	return {
		record(docId, outcome, { throttle = false, version } = {}) {
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
			const data = { ...dataOf(outcome, at), version: version ?? null }
			return enqueue(docId, async () => {
				await put(docId, data)
				memo.delete(docId)
			}).catch((err: unknown) => {
				// Unwritten, so the next success is written whatever the throttle says.
				successWrittenAt.delete(docId)
				throw err
			})
		},

		async readMany(docIds, versionOf) {
			// One read per document: `payload.kv` has no batch read, and a scope holds a few.
			const entries = await Promise.all(
				docIds.map(async (id): Promise<[string, ProviderStatus] | undefined> => {
					const at = now().getTime()
					let held = memo.get(id)
					if (!held || held.until <= at) {
						// Held before it answers, so requests arriving together share one read.
						const reading = { row: rowOf(id), until: at + STATUS_MEMO_MS }
						reading.row.catch(() => memo.get(id) === reading && memo.delete(id))
						memo.set(id, reading)
						held = reading
					}
					const status = seen(id, await held.row, versionOf?.(id))
					return status ? [id, status] : undefined
				})
			)
			return new Map(entries.filter((entry) => entry !== undefined))
		},

		forget(docId) {
			successWrittenAt.delete(docId)
			return enqueue(docId, async () => {
				await payload.kv.delete(providerStatusKey(docId))
				memo.delete(docId)
			})
		},

		carry(docId, from, to) {
			return enqueue(docId, async () => {
				const row = await rowOf(docId)
				if (row?.version === from) {
					await payload.kv.set(providerStatusKey(docId), { ...row, version: to })
					memo.delete(docId)
				}
			})
		},

		async idle() {
			await Promise.all(queues.values())
		},

		async read(docId, version) {
			return seen(docId, await rowOf(docId), version)
		},
	}
}
