import type { PollResponse } from '../shared/wire'
import { browserPollerEnv, createPoller, type PollerEnv, type PollerIntervals } from './poller'

/** A live link between one provider and the server's change signals. */
export type TransportConnection = {
	destroy: () => void
	/** Tell other tabs these keys changed through this tab's own action. */
	notify: (keys: string[]) => void
	/** A feed of the key is open here (`true`) or closed. */
	setActive: (key: string, active: boolean) => void
	/** Replace the watched keys and their subscription tokens. */
	watch: (entries: Array<{ key: string; token: string }>, since: string) => void
}

/**
 * The client half of a transport, passed to `ChatProvider`. Polling is the
 * default; a realtime adapter implements the same connection over its own
 * channel (SSE, websockets, a hosted pub/sub) and pairs with a server half
 * that implements `publish`.
 */
export type ConversationsClientTransport = {
	connect: (args: {
		instance: string
		onChange: (keys: string[]) => void
		onExpired: (keys: string[]) => void
		poll: (body: { since: string; tokens: string[] }) => Promise<PollResponse>
	}) => TransportConnection
}

/**
 * The default transport: polls only the keys mounted in visible tabs, one tab
 * per key across the browser, one request per tick.
 */
export const pollingTransport = (
	options: { env?: () => PollerEnv; intervals?: Partial<PollerIntervals> } = {}
): ConversationsClientTransport => ({
	connect: ({ instance, onChange, onExpired, poll }) =>
		createPoller({
			env: (options.env ?? browserPollerEnv)(),
			instance,
			intervals: {
				active: options.intervals?.active ?? 15_000,
				idle: options.intervals?.idle ?? 60_000,
			},
			onChange,
			onExpired,
			poll,
		}),
})
