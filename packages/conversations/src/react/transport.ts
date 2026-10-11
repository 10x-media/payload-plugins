import type { PollResponse } from '../shared/wire'
import { browserPollerEnv, createPoller, type PollerEnv, type PollerIntervals } from './poller'

/** One watched key: its subscription token and the channels the viewer reads there. */
export type WatchEntry = { channels?: string[]; key: string; token: string }

/** A live link between one provider and the server's change signals. */
export type TransportConnection = {
	destroy: () => void
	/** Tell other tabs these keys changed through this tab's own action. */
	notify: (keys: string[]) => void
	/** A feed of the key is open here (`true`) or closed. */
	setActive: (key: string, active: boolean) => void
	/** Replace the watched keys and their subscription tokens. */
	watch: (entries: WatchEntry[], since: string) => void
}

/**
 * The client half of a transport, passed to `ChatProvider`. Polling is the
 * default; a realtime adapter implements the same connection over its own
 * channel (SSE, websockets, a hosted pub/sub) and pairs with a server half
 * that implements `publish`.
 */
export type ConversationsClientTransport = {
	connect: (args: TransportConnectArgs) => TransportConnection
}

/** What the store hands a transport: its callbacks and the instance's endpoints. */
export type TransportConnectArgs = {
	/** Opens the instance's event stream; throws `ConversationsRequestError` when refused. */
	events: (body: { since?: string; tokens: string[] }, signal?: AbortSignal) => Promise<Response>
	instance: string
	onChange: (keys: string[]) => void
	onExpired: (keys: string[]) => void
	poll: (body: { since: string; tokens: string[] }) => Promise<PollResponse>
	/** POSTs to a transport's own endpoint under the instance, e.g. `/pusher-auth`. */
	post: <T>(path: string, body: unknown) => Promise<T>
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
