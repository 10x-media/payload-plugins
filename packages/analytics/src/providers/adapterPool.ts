import type { Payload } from 'payload'
import { currentTime } from '../core/clock'
import type { AnalyticsAdapter } from '../core/contract'

/** How long a pooled adapter no registry asked for is kept before it is closed. */
export const POOL_IDLE_MS = 5 * 60_000

/** How often idle adapters are looked for while anything is pooled. */
const SWEEP_EVERY_MS = 60_000

/** One saved state of one provider document: its id, its `updatedAt`, and the scope it was in. */
export interface PooledDocument {
	id: string
	version: string
	scope: string | null
}

interface AdapterPool {
	/**
	 * The adapter built for exactly this version of the document, marked as used; null when that
	 * version builds none, undefined when it was never built.
	 */
	get(doc: PooledDocument): AnalyticsAdapter | null | undefined
	/**
	 * Pools one document version's adapter and answers the one to hand out: an older pooled version
	 * is disposed, a newer one wins. Never closes an `owned: false` adapter (a lent native one).
	 */
	put(
		doc: PooledDocument,
		adapter: AnalyticsAdapter | null,
		owned: boolean
	): AnalyticsAdapter | null
	/** Marks the documents as used, so the idle sweep keeps them. */
	touch(ids: Iterable<string>): void
	/** Disposes every document pooled under `scope` that `keep` leaves out: removed, disabled or moved. */
	retain(scope: string | null, keep: ReadonlySet<string>): void
	/** Disposes what nothing used for the idle window, answering the ids it disposed. */
	sweep(): string[]
	/** Closes every pooled adapter: the runtime holding the pool is retired. */
	close(): Promise<void>
}

interface AdapterPoolOptions {
	/** The instance every pooled adapter serves, which is what `close(payload)` is told. */
	payload: Payload
	idleMs?: number
	now?: () => number
	/** Told each document version disposed, so whatever still hands its adapter out drops it. */
	onDispose?: (doc: PooledDocument) => void
}

interface Entry {
	doc: PooledDocument
	/** What the pool hands out: for an owned adapter, one that counts the calls in flight. */
	adapter: AnalyticsAdapter | null
	/** The adapter as built, whose `close` the pool calls. */
	built: AnalyticsAdapter | null
	owned: boolean
	usedAt: number
	inFlight: number
	retired: boolean
}

/**
 * Per-instance adapters keyed `id@updatedAt`, so an unchanged document is never decrypted again. A
 * disposed adapter closes once no call is in flight, and again after any late call.
 */
export const createAdapterPool = (options: AdapterPoolOptions): AdapterPool => {
	const { payload } = options
	const idleMs = options.idleMs ?? POOL_IDLE_MS
	const now = options.now ?? currentTime
	const entries = new Map<string, Entry>()
	const closing = new Set<Promise<void>>()
	let timer: ReturnType<typeof setInterval> | undefined

	const closeBuilt = (entry: Entry): void => {
		const { built } = entry
		if (!entry.owned || !built?.close) {
			return
		}
		const done = (async () => {
			try {
				await built.close?.(payload)
			} catch (err) {
				payload.logger?.warn(
					`analytics: closing the adapter of provider document "${entry.doc.id}" failed: ${String(err)}`
				)
			}
		})()
		closing.add(done)
		void done.finally(() => closing.delete(done))
	}

	const stopTimer = (): void => {
		clearInterval(timer)
		timer = undefined
	}

	const dispose = (entry: Entry): void => {
		entry.retired = true
		if (entries.get(entry.doc.id) === entry) {
			entries.delete(entry.doc.id)
		}
		if (entry.inFlight === 0) {
			closeBuilt(entry)
		}
		options.onDispose?.(entry.doc)
		if (entries.size === 0) {
			stopTimer()
		}
	}

	const tracked = (entry: Entry, adapter: AnalyticsAdapter): AnalyticsAdapter => {
		const counted = async <T>(call: () => Promise<T>): Promise<T> => {
			entry.inFlight++
			try {
				return await call()
			} finally {
				entry.inFlight--
				if (entry.retired && entry.inFlight === 0) {
					closeBuilt(entry)
				}
			}
		}
		const realtime = adapter.realtime?.bind(adapter)
		return {
			...adapter,
			query: (q, ctx) => counted(() => adapter.query(q, ctx)),
			...(realtime ? { realtime: (q, ctx) => counted(() => realtime(q, ctx)) } : {}),
		}
	}

	const sweep = (): string[] => {
		const at = now()
		const idle = [...entries.values()].filter(
			(entry) => entry.inFlight === 0 && at - entry.usedAt >= idleMs
		)
		for (const entry of idle) {
			dispose(entry)
		}
		return idle.map((entry) => entry.doc.id)
	}

	const startTimer = (): void => {
		if (timer === undefined) {
			timer = setInterval(sweep, SWEEP_EVERY_MS)
			timer.unref?.()
		}
	}

	return {
		get(doc) {
			const entry = entries.get(doc.id)
			if (!entry || entry.doc.version !== doc.version) {
				return undefined
			}
			entry.usedAt = now()
			return entry.adapter
		},
		put(doc, built, owned) {
			const pooled = entries.get(doc.id)
			if (pooled && pooled.doc.version >= doc.version) {
				pooled.usedAt = now()
				return pooled.adapter
			}
			if (pooled) {
				dispose(pooled)
			}
			const entry: Entry = {
				doc,
				adapter: null,
				built,
				owned,
				usedAt: now(),
				inFlight: 0,
				retired: false,
			}
			entry.adapter = built && owned ? tracked(entry, built) : built
			entries.set(doc.id, entry)
			startTimer()
			return entry.adapter
		},
		touch(ids) {
			const at = now()
			for (const id of ids) {
				const entry = entries.get(id)
				if (entry) {
					entry.usedAt = at
				}
			}
		},
		retain(scope, keep) {
			for (const entry of [...entries.values()]) {
				if (entry.doc.scope === scope && !keep.has(entry.doc.id)) {
					dispose(entry)
				}
			}
		},
		sweep,
		async close() {
			stopTimer()
			for (const entry of [...entries.values()]) {
				entry.retired = true
				entries.delete(entry.doc.id)
				closeBuilt(entry)
			}
			await Promise.all([...closing])
		},
	}
}
