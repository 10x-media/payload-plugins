import type { ClientTransportSpec } from '../types'
import { pusherClientTransport } from './pusher'
import { sseClientTransport } from './sse'
import { type ConversationsClientTransport, pollingTransport } from './transport'

/** Builds a custom client transport from its spec's `options`. */
export type ClientTransportFactory = (options: unknown) => ConversationsClientTransport

/**
 * The client transport a server transport asks for (`transport.client`):
 * polling, SSE, Pusher with its public options, or a custom one. The admin
 * uses it; a website can pass the same spec down from the server. A custom
 * spec names its factory by import path, which only the admin resolves:
 * elsewhere pass the imported `factory`, or it falls back to polling.
 */
export const transportFromSpec = (
	spec: ClientTransportSpec | undefined,
	factory?: ClientTransportFactory | null
): ConversationsClientTransport => {
	if (spec === 'sse') return sseClientTransport()
	if (typeof spec === 'object' && 'pusher' in spec) return pusherClientTransport(spec.pusher)
	if (typeof spec === 'object' && 'factory' in spec) {
		if (factory) return factory(spec.options)
		console.warn(
			`[@10x-media/conversations] the client transport "${spec.factory}" was not resolved; polling instead`
		)
	}
	return pollingTransport()
}
