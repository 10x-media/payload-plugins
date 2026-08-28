'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { RealtimeEvent } from '../broker/types'
import { type SubscriptionStatus, usePayloadSubscription } from './usePayloadSubscription'

export type PresencePeerPublic = { id: string; label: string }

export type UseDocumentPresenceOptions = {
	token?: string
	/** Absolute or origin-relative presence endpoint. Default `/api/realtime/presence`. */
	url?: string
	/** Heartbeat POST interval. Default 10_000. */
	heartbeatMs?: number
	/** Stream URL for the presence topic subscription. */
	streamUrl?: string
}

export type UseDocumentPresenceResult = {
	peers: PresencePeerPublic[]
	self: PresencePeerPublic | null
	status: SubscriptionStatus
}

const DEFAULT_PRESENCE_URL = '/api/realtime/presence'
const DEFAULT_HEARTBEAT_MS = 10_000

const peersFromEvent = (event: RealtimeEvent): PresencePeerPublic[] | null => {
	const data = event.data
	if (!data || typeof data !== 'object' || !('peers' in data)) {
		return null
	}
	const peers = (data as { peers: unknown }).peers
	if (!Array.isArray(peers)) {
		return null
	}
	return peers.filter(
		(peer): peer is PresencePeerPublic =>
			typeof peer === 'object' &&
			peer !== null &&
			typeof (peer as PresencePeerPublic).id === 'string' &&
			typeof (peer as PresencePeerPublic).label === 'string'
	)
}

/**
 * Maintains a presence lease for the current viewer and tracks peers on a document.
 */
export const useDocumentPresence = (
	collection: string,
	id: string,
	opts: UseDocumentPresenceOptions = {}
): UseDocumentPresenceResult => {
	const { token, url = DEFAULT_PRESENCE_URL, heartbeatMs = DEFAULT_HEARTBEAT_MS, streamUrl } = opts
	const [peers, setPeers] = useState<PresencePeerPublic[]>([])
	const [self, setSelf] = useState<PresencePeerPublic | null>(null)
	const tokenRef = useRef(token)
	tokenRef.current = token

	const heartbeat = useCallback(
		async (signal?: AbortSignal) => {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			}
			if (tokenRef.current) {
				headers.Authorization = `Bearer ${tokenRef.current}`
			}
			const res = await fetch(url, {
				method: 'POST',
				credentials: 'include',
				headers,
				body: JSON.stringify({ collection, id }),
				signal,
			})
			if (!res.ok) {
				return null
			}
			return (await res.json()) as {
				peers?: PresencePeerPublic[]
				self?: PresencePeerPublic
			}
		},
		[collection, id, url]
	)

	useEffect(() => {
		if (!collection || !id) {
			return
		}

		let disposed = false
		let interval: ReturnType<typeof setInterval> | undefined
		const abortController = new AbortController()

		const run = async () => {
			if (disposed) return
			try {
				const json = await heartbeat(abortController.signal)
				if (disposed || !json) return
				if (Array.isArray(json.peers)) {
					setPeers(json.peers)
				}
				if (json.self) {
					setSelf(json.self)
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					return
				}
			}
		}

		void run()
		interval = setInterval(() => {
			void run()
		}, heartbeatMs)

		return () => {
			disposed = true
			abortController.abort()
			if (interval !== undefined) {
				clearInterval(interval)
			}
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			}
			if (tokenRef.current) {
				headers.Authorization = `Bearer ${tokenRef.current}`
			}
			void fetch(url, {
				method: 'DELETE',
				credentials: 'include',
				keepalive: true,
				headers,
				body: JSON.stringify({ collection, id }),
			}).catch(() => {})
		}
	}, [collection, id, url, heartbeatMs, heartbeat])

	const { status } = usePayloadSubscription({
		topics: collection && id ? [`presence:${collection}:${id}`] : [],
		token,
		url: streamUrl,
		onEvent: (event) => {
			if (event.event !== 'presence:join' && event.event !== 'presence:leave') {
				return
			}
			const next = peersFromEvent(event)
			if (next) {
				setPeers(next)
			}
		},
	})

	return { peers, self, status }
}
