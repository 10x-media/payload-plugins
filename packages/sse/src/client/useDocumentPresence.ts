'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { RealtimeEvent } from '../broker/types'
import type { PresenceMode } from '../presence/store'
import { type SubscriptionStatus, usePayloadSubscription } from './usePayloadSubscription'

export type { PresenceMode }

export type PresencePeerPublic = { id: string; label: string; mode: PresenceMode }

export type UseDocumentPresenceOptions = {
	token?: string
	/** Absolute or origin-relative presence endpoint. Default `/api/realtime/presence`. */
	url?: string
	/** Heartbeat POST interval. Default 10_000. */
	heartbeatMs?: number
	/** Stream URL for the presence topic subscription. */
	streamUrl?: string
	/** Advisory viewer vs editor. Omit on heartbeat to keep the server mode. */
	mode?: PresenceMode
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
	return peers.flatMap((peer) => {
		const next = publicPeerFromUnknown(peer)
		return next ? [next] : []
	})
}

const publicPeerFromUnknown = (peer: unknown): PresencePeerPublic | null => {
	if (typeof peer !== 'object' || peer === null) {
		return null
	}
	const candidate = peer as { id?: unknown; label?: unknown; mode?: unknown }
	if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
		return null
	}
	return {
		id: candidate.id,
		label: candidate.label,
		mode: candidate.mode === 'editing' ? 'editing' : 'viewing',
	}
}

/**
 * Maintains a presence lease for the current viewer and tracks peers on a document.
 */
export const useDocumentPresence = (
	collection: string,
	id: string,
	opts: UseDocumentPresenceOptions = {}
): UseDocumentPresenceResult => {
	const {
		token,
		url = DEFAULT_PRESENCE_URL,
		heartbeatMs = DEFAULT_HEARTBEAT_MS,
		streamUrl,
		mode,
	} = opts
	const [peers, setPeers] = useState<PresencePeerPublic[]>([])
	const [self, setSelf] = useState<PresencePeerPublic | null>(null)
	const tokenRef = useRef(token)
	tokenRef.current = token
	const modeRef = useRef(mode)
	modeRef.current = mode
	const leaseAbortRef = useRef<AbortController | null>(null)

	const applyPresenceJson = useCallback((json: { peers?: unknown; self?: unknown }) => {
		if (Array.isArray(json.peers)) {
			setPeers(
				json.peers.flatMap((peer) => {
					const next = publicPeerFromUnknown(peer)
					return next ? [next] : []
				})
			)
		}
		const nextSelf = publicPeerFromUnknown(json.self)
		if (nextSelf) {
			setSelf(nextSelf)
		}
	}, [])

	const heartbeat = useCallback(
		async (signal?: AbortSignal) => {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			}
			if (tokenRef.current) {
				headers.Authorization = `Bearer ${tokenRef.current}`
			}
			const currentMode = modeRef.current
			const body =
				currentMode === undefined ? { collection, id } : { collection, id, mode: currentMode }
			const res = await fetch(url, {
				method: 'POST',
				credentials: 'include',
				headers,
				body: JSON.stringify(body),
				signal,
			})
			if (!res.ok) {
				return null
			}
			return (await res.json()) as {
				peers?: unknown
				self?: unknown
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
		leaseAbortRef.current = abortController

		const run = async () => {
			if (disposed) return
			try {
				const json = await heartbeat(abortController.signal)
				if (disposed || !json) return
				applyPresenceJson(json)
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
			if (leaseAbortRef.current === abortController) {
				leaseAbortRef.current = null
			}
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
	}, [collection, id, url, heartbeatMs, heartbeat, applyPresenceJson])

	const prevModeRef = useRef(mode)
	useEffect(() => {
		if (!collection || !id) {
			return
		}
		if (prevModeRef.current === mode) {
			return
		}
		prevModeRef.current = mode
		let cancelled = false
		void heartbeat(leaseAbortRef.current?.signal)
			.then((json) => {
				if (!cancelled && json) {
					applyPresenceJson(json)
				}
			})
			.catch((err) => {
				if (err instanceof DOMException && err.name === 'AbortError') {
					return
				}
			})
		return () => {
			cancelled = true
		}
	}, [collection, id, mode, heartbeat, applyPresenceJson])

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
