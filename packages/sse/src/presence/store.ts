import type { KVAdapter } from 'payload'

export type PresencePeer = {
	id: string
	label: string
	expiresAt: number
}

type PresenceValue = {
	peers: PresencePeer[]
}

export type PresenceStore = {
	get: (args: { collection: string; id: string }) => Promise<PresencePeer[]>
	join: (args: {
		collection: string
		id: string
		peer: { id: string; label: string }
	}) => Promise<PresencePeer[]>
	heartbeat: (args: {
		collection: string
		id: string
		peer: { id: string; label: string }
	}) => Promise<PresencePeer[]>
	leave: (args: { collection: string; id: string; peerId: string }) => Promise<PresencePeer[]>
}

const keyFor = (collection: string, id: string): string => `sse:presence:${collection}:${id}`

const prune = (peers: PresencePeer[], now: number): PresencePeer[] =>
	peers.filter((peer) => peer.expiresAt > now)

/**
 * Presence lease store over Payload KV. Per-key writes are serialized in-process.
 * Never scans keys; each document has a single known key.
 */
export const createPresenceStore = (
	kv: KVAdapter,
	opts: { leaseMs: number; now?: () => number }
): PresenceStore => {
	const now = opts.now ?? (() => Date.now())

	const chains = new Map<string, Promise<unknown>>()

	const exclusive = <T>(key: string, work: () => Promise<T>): Promise<T> => {
		const prev = chains.get(key) ?? Promise.resolve()
		const run = prev.then(work, work)
		chains.set(
			key,
			run.then(
				() => undefined,
				() => undefined
			)
		)
		return run
	}

	const read = async (collection: string, id: string): Promise<PresencePeer[]> => {
		const raw = await kv.get<PresenceValue>(keyFor(collection, id))
		if (!raw || !Array.isArray(raw.peers)) {
			return []
		}
		return prune(raw.peers, now())
	}

	const write = async (
		collection: string,
		id: string,
		peers: PresencePeer[]
	): Promise<PresencePeer[]> => {
		const key = keyFor(collection, id)
		if (peers.length === 0) {
			await kv.delete(key)
			return []
		}
		await kv.set(key, { peers } satisfies PresenceValue)
		return peers
	}

	const upsert = async (args: {
		collection: string
		id: string
		peer: { id: string; label: string }
	}): Promise<PresencePeer[]> => {
		const current = await read(args.collection, args.id)
		const expiresAt = now() + opts.leaseMs
		const next: PresencePeer = { id: args.peer.id, label: args.peer.label, expiresAt }
		const without = current.filter((peer) => peer.id !== args.peer.id)
		return write(args.collection, args.id, [...without, next])
	}

	return {
		get: ({ collection, id }) =>
			exclusive(keyFor(collection, id), async () => {
				const key = keyFor(collection, id)
				const raw = await kv.get<PresenceValue>(key)
				if (!raw || !Array.isArray(raw.peers)) {
					return []
				}
				const peers = prune(raw.peers, now())
				if (peers.length === 0) {
					await kv.delete(key)
					return []
				}
				if (peers.length !== raw.peers.length) {
					await kv.set(key, { peers } satisfies PresenceValue)
				}
				return peers
			}),
		join: (args) => exclusive(keyFor(args.collection, args.id), () => upsert(args)),
		heartbeat: (args) => exclusive(keyFor(args.collection, args.id), () => upsert(args)),
		leave: ({ collection, id, peerId }) =>
			exclusive(keyFor(collection, id), async () => {
				const current = await read(collection, id)
				return write(
					collection,
					id,
					current.filter((peer) => peer.id !== peerId)
				)
			}),
	}
}
