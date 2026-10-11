import type { Payload } from 'payload'

import type { ConversationsInstance } from '../types'

/** A change a feed should hear about: the key, and the channel when known. */
export type RealtimeSignal = { channel?: string; key: string }

/**
 * How one server process learns about changes written by the others. The
 * process that wrote a change tells its own connections at once; a bus is
 * only for the rest. Pairs with `sseTransport({ bus })`.
 */
export type ConversationsBus = {
	/** After a write in this process: tell the others, if the bus needs telling. */
	publish?: (args: {
		instance: ConversationsInstance
		payload: Payload
		signal: RealtimeSignal
	}) => Promise<void> | void
	/**
	 * Start hearing the other processes' changes for one instance while this
	 * process holds connections. `watched` names the keys they follow now.
	 * Returns the stop.
	 */
	subscribe: (args: {
		instance: ConversationsInstance
		onSignals: (signals: RealtimeSignal[]) => void
		payload: Payload
		watched: () => string[]
	}) => () => void
}

/** One process only: nothing to hear from anyone else. */
export const memoryBus = (): ConversationsBus => ({
	subscribe: () => () => undefined,
})

/** How far back each check looks past the previous one: late commits, clock skew. */
const OVERLAP_MS = 5000
/** Rows one check reads at most; a burst past it is picked up by the next one. */
const BATCH = 500

type Row = { channel?: string; id: number | string; key: string; updatedAt: string }

/**
 * The shared loop of `databaseBus` and `payloadKVBus`: while a process holds
 * connections, check the messages of the keys they follow once per
 * `intervalMs`. With `revision`, a `payload.kv` entry that every write bumps
 * is read first and the query skipped while it has not moved (a full check
 * still runs every `fullCheckMs`).
 */
const checkingBus = ({
	fullCheckMs = 15_000,
	intervalMs = 1000,
	revision = false,
}: {
	fullCheckMs?: number
	intervalMs?: number
	revision?: boolean
}): ConversationsBus => {
	const revisionKey = (instance: ConversationsInstance) => `conversations:${instance.slug}:revision`
	return {
		publish: async ({ instance, payload }) => {
			if (revision) await payload.kv.set(revisionKey(instance), Date.now())
		},
		subscribe: ({ instance, onSignals, payload, watched }) => {
			let stopped = false
			let timer: ReturnType<typeof setTimeout> | undefined
			let from = new Date(Date.now() - OVERLAP_MS).toISOString()
			let lastRevision: unknown = null
			let lastFull = 0
			/** Rows already signalled, by `id|updatedAt`, until they fall out of the overlap. */
			const seen = new Map<string, string>()

			const check = async () => {
				const keys = watched()
				if (keys.length === 0) return
				const started = Date.now()
				if (revision) {
					const current = await payload.kv.get(revisionKey(instance))
					if (current === lastRevision && started - lastFull < fullCheckMs) return
					lastRevision = current
				}
				lastFull = started
				const result = await payload.db.find({
					collection: instance.messagesSlug,
					limit: BATCH,
					pagination: false,
					select: { channel: true, key: true, updatedAt: true },
					sort: 'updatedAt',
					where: { and: [{ updatedAt: { greater_than_equal: from } }, { key: { in: keys } }] },
				})
				const signals: RealtimeSignal[] = []
				for (const row of result.docs as unknown as Row[]) {
					const id = `${String(row.id)}|${row.updatedAt}`
					if (seen.has(id)) continue
					seen.set(id, row.updatedAt)
					signals.push({ channel: row.channel, key: row.key })
				}
				const rows = result.docs as unknown as Row[]
				const newest = rows.at(-1)?.updatedAt
				// A full batch means more is waiting: continue from its end, not from now.
				const next =
					rows.length >= BATCH && newest ? newest : new Date(started - OVERLAP_MS).toISOString()
				if (next > from) from = next
				for (const [id, at] of seen) {
					if (at < from) seen.delete(id)
				}
				if (signals.length > 0) onSignals(signals)
			}

			const loop = async () => {
				try {
					await check()
				} catch (error) {
					payload.logger.error({ err: error, msg: '[conversations] realtime check failed' })
				}
				if (!stopped) timer = setTimeout(() => void loop(), intervalMs)
			}
			timer = setTimeout(() => void loop(), intervalMs)
			return () => {
				stopped = true
				if (timer) clearTimeout(timer)
			}
		},
	}
}

/**
 * The database as the bus, with nothing else to run and nothing written:
 * messages already carry `updatedAt`, so each process that holds connections
 * asks once per `intervalMs` (default 1 s), in one indexed query, what changed
 * among the keys they follow, however many people are connected. Works on
 * every adapter and any number of processes. The default.
 */
export const databaseBus = ({ intervalMs }: { intervalMs?: number } = {}): ConversationsBus =>
	checkingBus({ intervalMs })

/**
 * Payload's KV store as a change flag in front of the database: every write
 * bumps one `payload.kv` entry per instance, and each process reads it once
 * per `intervalMs` and queries the messages only when it moved (plus a full
 * check every `fullCheckMs`, default 15 s). Worth it when `payload.kv` runs on
 * Redis: the per-second cost becomes a key read. On the default database KV
 * it trades one query for another, so prefer `databaseBus` there.
 */
export const payloadKVBus = ({
	fullCheckMs,
	intervalMs,
}: {
	fullCheckMs?: number
	intervalMs?: number
} = {}): ConversationsBus => checkingBus({ fullCheckMs, intervalMs, revision: true })
