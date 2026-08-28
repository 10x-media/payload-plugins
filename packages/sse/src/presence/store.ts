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
 * Last-writer-wins presence lease store over Payload KV.
 * Never scans keys; each document has a single known key.
 */
export const createPresenceStore = (
	kv: KVAdapter,
	opts: { leaseMs: number; now?: () => number }
): PresenceStore => {
	const now = opts.now ?? (() => Date.now())

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
		get: async ({ collection, id }) => {
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
		},
		join: upsert,
		heartbeat: upsert,
		leave: async ({ collection, id, peerId }) => {
			const current = await read(collection, id)
			return write(
				collection,
				id,
				current.filter((peer) => peer.id !== peerId)
			)
		},
	}
}
