export type SSEOperation = 'create' | 'update' | 'delete'

export type ThinRealtimeEvent = {
	id: string
	topic: string
	event: SSEOperation | 'ready' | 'presence:join' | 'presence:leave' | (string & {})
	collection?: string
	docId?: string
	operation?: SSEOperation
	timestamp: number
	/** Writer user id when `req.user` has an id. Omitted for Local API / jobs. */
	actorId?: string
	/** Concrete scope this event was published under. Absent when scoping is off. */
	scope?: string
}

export type RealtimeEvent<T = unknown> = ThinRealtimeEvent & { data?: T }

export type EventBroker = {
	/** Must not throw and must not block the caller on I/O. */
	publish(event: RealtimeEvent): void
	subscribe(topic: string, callback: (event: RealtimeEvent) => void): () => void
	destroy(): Promise<void>
}
