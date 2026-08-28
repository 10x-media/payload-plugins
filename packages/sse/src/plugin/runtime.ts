import type { Payload } from 'payload'

import type { EventBroker, RealtimeEvent, SSEOperation } from '../broker/types'
import type { ResolvedPresenceOptions } from '../options'
import type { PresenceStore } from '../presence/store'
import type { SSEScopeOptions } from '../scope/types'

export type SSEPresenceRuntime = ResolvedPresenceOptions & {
	store: PresenceStore
}

export type SSERuntime = {
	broker: EventBroker
	collections: Record<string, { thinEvents: boolean; events: SSEOperation[] }>
	heartbeatMs: number
	presence: SSEPresenceRuntime | false
	scope: SSEScopeOptions | false
	destroy: () => Promise<void>
	emit: (event: RealtimeEvent) => void
}

/**
 * Stored on the Payload instance (not a module WeakMap) so the runtime survives
 * the separate `.` and `/rsc` bundles a consumer loads. `Symbol.for` keys into
 * the cross-realm global symbol registry.
 */
const RUNTIME_KEY = Symbol.for('@10x-media/sse/runtime')

type RuntimeHost = { [RUNTIME_KEY]?: SSERuntime }

export const setRuntime = (payload: Payload, runtime: SSERuntime): void => {
	;(payload as unknown as RuntimeHost)[RUNTIME_KEY] = runtime
}

export const getRuntime = (payload: Payload): SSERuntime | undefined =>
	(payload as unknown as RuntimeHost)[RUNTIME_KEY]

export const getSSE = (payload: Payload): { emit: SSERuntime['emit'] } => {
	const runtime = getRuntime(payload)
	if (!runtime) {
		throw new Error(
			'@10x-media/sse: runtime not initialized. Is the plugin enabled and has onInit run?'
		)
	}
	return { emit: runtime.emit }
}

type ErrorLog = { error: (message: string, err?: unknown) => void }

export const createEmit =
	(broker: EventBroker, log?: ErrorLog): SSERuntime['emit'] =>
	(event) => {
		try {
			broker.publish(event)
		} catch (err) {
			log?.error('@10x-media/sse: emit failed', err)
		}
	}
