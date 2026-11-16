import type { Payload } from 'payload'
import type { AnalyticsAdapter } from '../core/contract'
import { isUnknownSite } from '../core/sourceErrors'
import { classifyError, vendorAnswerOf } from '../surfacing/classifyError'
import type { ConnectionOutcome } from './connectionState'
import type { ProviderStatusStore } from './status'

/** How long a connection check waits for the vendor before it counts as unreachable. */
const CONNECTION_CHECK_TIMEOUT_MS = 10_000

/**
 * What a check's failure says about the connection: a vendor refusing the cheapest read it has is
 * set up wrong whatever its status code, so only an outage stays `unavailable`.
 */
const checkFailureOf = (err: unknown): ConnectionOutcome => {
	const failure = classifyError(err)
	const vendorAnswer = failure.hostRefused ? undefined : vendorAnswerOf(err)
	return {
		ok: false,
		kind: failure.kind === 'unavailable' ? 'unavailable' : 'source_misconfigured',
		...(isUnknownSite(err) ? { reason: 'unknownSite' } : {}),
		...(vendorAnswer === undefined ? {} : { detail: vendorAnswer }),
	}
}

/** What a provider document's check found; an incomplete document is refused without asking the vendor. */
export const checkConnectionOf = async (
	payload: Payload,
	adapter: AnalyticsAdapter
): Promise<ConnectionOutcome> => {
	if (!adapter.isConfigured()) {
		return { ok: false, kind: 'source_misconfigured', reason: 'incomplete' }
	}
	try {
		await adapter.checkConnection?.({
			signal: AbortSignal.timeout(CONNECTION_CHECK_TIMEOUT_MS),
			timeoutMs: CONNECTION_CHECK_TIMEOUT_MS,
			payload,
		})
		return { ok: true }
	} catch (err) {
		return checkFailureOf(err)
	}
}

/** Checks of failing provider documents that run without anyone waiting on them. */
export interface ConnectionRecheck {
	/** Starts a check of `docId` and writes what it found, unless one started within the cooldown. */
	request(docId: string): void
	/** Waits for the checks still running, for a runtime that closes or a test that settles. */
	idle(): Promise<void>
	/** Documents currently held, which is one cooldown's distinct documents at most. */
	readonly size: number
}

/**
 * Background checks of failing provider documents, at most one per document per `cooldownMs`, so
 * a document that cannot be checked (a refused host, a key that will not decrypt) is not rebuilt
 * on every read.
 */
export const createConnectionRecheck = (args: {
	payload: Payload
	store: ProviderStatusStore
	adapterFor: (docId: string) => Promise<AnalyticsAdapter | null>
	/** The saved version of the document an adapter was built from, stamped on what it found. */
	versionOf?: (adapter: AnalyticsAdapter) => string | undefined
	now: () => number
	cooldownMs: number
	warn: (message: string) => void
}): ConnectionRecheck => {
	const startedAt = new Map<string, number>()
	const running = new Set<Promise<void>>()
	return {
		request(docId) {
			const at = args.now()
			const last = startedAt.get(docId)
			if (last !== undefined && at - last < args.cooldownMs) {
				return
			}
			for (const [seen, when] of startedAt) {
				if (at - when >= args.cooldownMs) {
					startedAt.delete(seen)
				}
			}
			startedAt.set(docId, at)
			const check = async () => {
				const adapter = await args.adapterFor(docId)
				// Nothing to check, and nothing to close: a native document's adapter is the
				// instance's engine, lent rather than built for the check.
				if (!adapter?.checkConnection) {
					return
				}
				try {
					const version = args.versionOf?.(adapter)
					await args.store.record(
						docId,
						await checkConnectionOf(args.payload, adapter),
						version === undefined ? {} : { version }
					)
				} finally {
					await adapter.close?.(args.payload)
				}
			}
			const run = check().catch((err: unknown) => {
				args.warn(`analytics: checking provider document "${docId}" again failed: ${String(err)}`)
			})
			running.add(run)
			void run.finally(() => running.delete(run))
		},
		idle: async () => {
			await Promise.all(running)
		},
		get size() {
			return startedAt.size
		},
	}
}
