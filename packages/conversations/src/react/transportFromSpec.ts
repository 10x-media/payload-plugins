import type { ClientTransportSpec } from '../types'
import { pusherClientTransport } from './pusher'
import { sseClientTransport } from './sse'
import { type ConversationsClientTransport, pollingTransport } from './transport'

/**
 * The client transport a server transport asks for (`transport.client`):
 * polling, SSE, or Pusher with its public options. The admin uses it; a
 * website can pass the same spec down from the server.
 */
export const transportFromSpec = (
	spec: ClientTransportSpec | undefined
): ConversationsClientTransport => {
	if (spec === 'sse') return sseClientTransport()
	if (typeof spec === 'object') return pusherClientTransport(spec.pusher)
	return pollingTransport()
}
