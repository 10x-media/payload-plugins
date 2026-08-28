'use client'

import { useEffect, useRef, useState } from 'react'

import type { RealtimeEvent } from '../broker/types'
import { buildStreamUrl, createSseParser } from './parseSse'

export type SubscriptionStatus = 'connecting' | 'open' | 'closed'

export type UsePayloadSubscriptionOptions = {
	topics: string[]
	/** Absolute or origin-relative. Default `/api/realtime/stream`. */
	url?: string
	/** If set, send `Authorization: Bearer ${token}` on the fetch stream. */
	token?: string
	onEvent?: (event: RealtimeEvent) => void
}

const DEFAULT_URL = '/api/realtime/stream'
const DEFAULT_RETRY_MS = 3000

function parseEventData(raw: string | undefined, eventName?: string): RealtimeEvent | null {
	if (!raw) {
		return null
	}
	try {
		const parsed = JSON.parse(raw) as RealtimeEvent
		if (eventName && eventName !== 'message' && !parsed.event) {
			return { ...parsed, event: eventName }
		}
		return parsed
	} catch {
		return null
	}
}

export const usePayloadSubscription = (
	options: UsePayloadSubscriptionOptions
): { status: SubscriptionStatus; lastEvent: RealtimeEvent | null } => {
	const { topics, url = DEFAULT_URL, token, onEvent } = options
	const [status, setStatus] = useState<SubscriptionStatus>('connecting')
	const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null)
	const onEventRef = useRef(onEvent)
	onEventRef.current = onEvent
	const topicsRef = useRef(topics)
	topicsRef.current = topics

	const topicsKey = topics.join(',')

	useEffect(() => {
		void topicsKey
		if (topicsRef.current.length === 0) {
			setStatus('closed')
			return
		}

		let disposed = false
		let retryMs = DEFAULT_RETRY_MS
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined
		let abortController: AbortController | null = null

		const deliver = (event: RealtimeEvent) => {
			if (disposed) {
				return
			}
			setLastEvent(event)
			onEventRef.current?.(event)
			if (event.event === 'ready') {
				setStatus('open')
			}
		}

		const handleRaw = (raw: string | undefined, eventName?: string) => {
			const event = parseEventData(raw, eventName)
			if (event) {
				deliver(event)
			}
		}

		const scheduleReconnect = () => {
			if (disposed) {
				return
			}
			setStatus('connecting')
			reconnectTimer = setTimeout(() => {
				if (!disposed) {
					connect()
				}
			}, retryMs)
		}

		const connect = async () => {
			if (disposed) {
				return
			}
			setStatus('connecting')
			const streamUrl = buildStreamUrl(url, topicsRef.current)
			abortController = new AbortController()

			const headers: Record<string, string> = {
				Accept: 'text/event-stream',
			}
			if (token) {
				headers.Authorization = `Bearer ${token}`
			}

			try {
				const response = await fetch(streamUrl, {
					credentials: 'include',
					headers,
					signal: abortController.signal,
				})

				if (!response.ok) {
					if (!disposed) {
						if (response.status >= 400 && response.status < 500) {
							setStatus('closed')
						} else {
							scheduleReconnect()
						}
					}
					return
				}

				if (!response.body) {
					if (!disposed) {
						scheduleReconnect()
					}
					return
				}

				const reader = response.body.getReader()
				const decoder = new TextDecoder()
				const parser = createSseParser((frame) => {
					if (frame.retry !== undefined) {
						retryMs = frame.retry
					}
					handleRaw(frame.data, frame.event)
				})

				while (!disposed) {
					const { done, value } = await reader.read()
					if (done) {
						break
					}
					parser.push(decoder.decode(value, { stream: true }))
				}

				if (!disposed) {
					scheduleReconnect()
				}
			} catch (err) {
				if (disposed || (err instanceof DOMException && err.name === 'AbortError')) {
					return
				}
				if (!disposed) {
					scheduleReconnect()
				}
			}
		}

		void connect()

		return () => {
			disposed = true
			if (reconnectTimer !== undefined) {
				clearTimeout(reconnectTimer)
			}
			if (abortController) {
				abortController.abort()
				abortController = null
			}
		}
	}, [topicsKey, url, token])

	return { status, lastEvent }
}
