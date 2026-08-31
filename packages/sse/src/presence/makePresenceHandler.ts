import type { PayloadHandler } from 'payload'

import type { EventBroker, RealtimeEvent } from '../broker/types'
import type { PresenceIdentify } from '../options'
import type { SSEScopeOptions } from '../scope/types'
import { authorizeTopics } from '../stream/authorizeTopics'
import type { PresencePeer, PresenceStore } from './store'

export const PRESENCE_PATH = '/realtime/presence'

type ErrorLog = { error: (message: string, err?: unknown) => void }

export type PresenceHandlerDeps = {
	store: PresenceStore
	broker: EventBroker
	identify: PresenceIdentify
	/** Plugin opted-in collections; presence is refused outside this map. */
	collections: Record<string, { thinEvents: boolean }>
	scope?: SSEScopeOptions | false
	log?: ErrorLog
}

type PresenceBody = {
	collection?: unknown
	id?: unknown
}

const publicPeers = (peers: PresencePeer[]): Array<{ id: string; label: string }> =>
	peers.map(({ id, label }) => ({ id, label }))

const parseBody = async (req: {
	json?: () => Promise<unknown>
	url?: string
}): Promise<{ collection: string; id: string } | null> => {
	let body: PresenceBody = {}
	try {
		const parsed = await req.json?.()
		if (parsed && typeof parsed === 'object') {
			body = parsed as PresenceBody
		}
	} catch {
		// Body may be empty on DELETE with query params.
	}

	const url = new URL(req.url ?? '', 'http://localhost')
	const collection =
		typeof body.collection === 'string' && body.collection.length > 0
			? body.collection
			: (url.searchParams.get('collection') ?? '')
	const id =
		typeof body.id === 'string' && body.id.length > 0
			? body.id
			: typeof body.id === 'number'
				? String(body.id)
				: (url.searchParams.get('id') ?? '')

	if (!collection || !id) {
		return null
	}
	return { collection, id }
}

const publishSafe = (broker: EventBroker, event: RealtimeEvent, log?: ErrorLog): void => {
	try {
		broker.publish(event)
	} catch (err) {
		log?.error('@10x-media/sse: presence publish failed', err)
	}
}

/**
 * Authenticated POST (join/heartbeat) and DELETE (leave) for document presence leases.
 */
export const makePresenceHandler = (deps: PresenceHandlerDeps): PayloadHandler => {
	const { store, broker, identify, collections, scope = false, log } = deps

	return async (req) => {
		if (!req.user) {
			return Response.json({ message: 'unauthorized' }, { status: 401 })
		}

		const target = await parseBody(req)
		if (!target) {
			return Response.json({ message: 'collection and id are required' }, { status: 400 })
		}

		if (!(target.collection in collections)) {
			return Response.json(
				{ message: `collection not enabled for sse: ${target.collection}` },
				{ status: 403 }
			)
		}

		const topic = `presence:${target.collection}:${target.id}`
		const auth = await authorizeTopics({
			req,
			topics: [topic],
			collections,
			scope,
		})
		if (!auth.ok) {
			return Response.json({ message: auth.message }, { status: auth.status })
		}

		const self = identify(req.user)
		const method = (req.method ?? 'POST').toUpperCase()

		if (method === 'DELETE') {
			const peers = await store.leave({
				collection: target.collection,
				id: target.id,
				peerId: self.id,
			})
			publishSafe(
				broker,
				{
					id: `${topic}:leave:${self.id}:${Date.now()}`,
					topic,
					event: 'presence:leave',
					collection: target.collection,
					docId: target.id,
					timestamp: Date.now(),
					data: { peers: publicPeers(peers) },
				},
				log
			)
			return Response.json({ peers: publicPeers(peers) })
		}

		const peers = await store.join({
			collection: target.collection,
			id: target.id,
			peer: self,
		})
		publishSafe(
			broker,
			{
				id: `${topic}:join:${self.id}:${Date.now()}`,
				topic,
				event: 'presence:join',
				collection: target.collection,
				docId: target.id,
				timestamp: Date.now(),
				data: { peers: publicPeers(peers) },
			},
			log
		)
		return Response.json({ peers: publicPeers(peers), self })
	}
}
