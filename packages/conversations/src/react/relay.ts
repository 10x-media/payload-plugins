import type { PollerEnv } from './poller'
import type { TransportConnectArgs, TransportConnection, WatchEntry } from './transport'

/** What a realtime source reports to the relay. */
export type SourceHandlers = {
	/** These keys changed; `at` is the server time of the news, where a resume starts. */
	changed: (keys: string[]) => void
	/** Their tokens ran out: the tabs renew them through `subscribe`. */
	expired: (keys: string[]) => void
	/** News flows (`true`), or it does not and the tabs poll until it does. */
	health: (up: boolean) => void
}

/**
 * One realtime connection (an SSE stream, a Pusher socket), opened by the
 * relay in the tab that holds it. Keeps itself up (reconnects, backoff) and
 * reports through the handlers.
 */
export type RealtimeSource = {
	destroy: () => void
	/** Follow exactly these keys now, every tab's; `since` is the oldest issue time among them. */
	watch: (entries: WatchEntry[], since: null | string) => void
}

/** What tabs tell each other about one instance's realtime connection. */
type Message =
	/** A tab's watched keys, for the tab holding the connection. */
	| { entries: WatchEntry[]; from: string; kind: 'watch' }
	/** The connection's news, or a tab's own action: these keys changed. */
	| { from: string; keys: string[]; kind: 'changed' }
	/** Tokens of these keys ran out: their tabs renew them. */
	| { from: string; keys: string[]; kind: 'expired' }
	/** Whether news flows; while it does not, every tab polls its own keys. */
	| { from: string; kind: 'health'; up: boolean }
	/** A new holder asks every tab for its keys. */
	| { from: string; kind: 'hello' }
	| { from: string; kind: 'bye' }

/**
 * Shares one realtime connection among the tabs of a browser. A Web Lock
 * (`conversations:<instance>:<name>`) picks the tab that opens it; the
 * others send that tab their keys and hear its news over a
 * `BroadcastChannel`. When the holder closes, the browser hands the lock to
 * the next tab, which reopens the connection for everyone.
 *
 * While news does not flow (connecting, dropped, refused) each tab runs
 * `fallback` for its own keys; while it flows, the fallback watches nothing.
 * Without Web Locks or `BroadcastChannel` each tab opens its own connection.
 */
export const createRelay = ({
	env,
	fallback,
	instance,
	name,
	onChange,
	onExpired,
	open,
}: Pick<TransportConnectArgs, 'instance' | 'onChange' | 'onExpired'> & {
	env: PollerEnv
	fallback: TransportConnection
	/** Names the lock and the channel, so two transports never share one. */
	name: string
	/** Opens the connection in the holding tab. */
	open: (handlers: SourceHandlers) => RealtimeSource
}): TransportConnection => {
	const id = Math.random().toString(36).slice(2)
	const shared = Boolean(env.locks && env.openChannel)
	const channel = shared ? (env.openChannel?.(`conversations:${instance}:${name}`) ?? null) : null
	let own: WatchEntry[] = []
	let ownSince: null | string = null
	const peers = new Map<string, WatchEntry[]>()
	let up = false
	let source: null | RealtimeSource = null
	let destroyed = false
	let releaseLock: (() => void) | null = null
	const lockAbort = new AbortController()

	const post = (message: Message) => channel?.postMessage(message)

	/** Poll only while news does not flow, so the two never both run. */
	const setUp = (next: boolean) => {
		up = next
		fallback.watch(up ? [] : own, ownSince ?? new Date(env.now()).toISOString())
	}

	const hear = (keys: string[], then: (keys: string[]) => void) => {
		const ownKeys = new Set(own.map((entry) => entry.key))
		const mine = keys.filter((key) => ownKeys.has(key))
		if (mine.length > 0) then(mine)
	}

	/** Every tab's keys; a key two tabs follow keeps the holder's token. */
	const everyone = (): WatchEntry[] => {
		const all = new Map<string, WatchEntry>()
		for (const entries of peers.values()) for (const entry of entries) all.set(entry.key, entry)
		for (const entry of own) all.set(entry.key, entry)
		return [...all.values()]
	}

	const follow = () => source?.watch(everyone(), ownSince)

	const lead = () => {
		source = open({
			changed: (keys) => {
				hear(keys, onChange)
				post({ from: id, keys, kind: 'changed' })
			},
			expired: (keys) => {
				hear(keys, onExpired)
				post({ from: id, keys, kind: 'expired' })
			},
			health: (next) => {
				setUp(next)
				post({ from: id, kind: 'health', up: next })
			},
		})
		post({ from: id, kind: 'hello' })
		follow()
	}

	if (channel) {
		channel.onmessage = (event: MessageEvent) => {
			const message = event.data as Message
			if (!message || message.from === id) return
			switch (message.kind) {
				case 'watch':
					peers.set(message.from, message.entries)
					follow()
					return
				case 'changed':
					hear(message.keys, onChange)
					return
				case 'expired':
					hear(message.keys, onExpired)
					return
				case 'health':
					if (!source) setUp(message.up)
					return
				case 'hello':
					post({ entries: own, from: id, kind: 'watch' })
					if (!source) setUp(false)
					return
				case 'bye':
					if (peers.delete(message.from)) follow()
					return
			}
		}
	}

	if (shared && env.locks) {
		env.locks
			.request(`conversations:${instance}:${name}`, { signal: lockAbort.signal }, () => {
				if (destroyed) return undefined
				lead()
				// Held for this tab's life; the browser hands it on when the tab closes.
				return new Promise<void>((resolve) => {
					releaseLock = resolve
				})
			})
			.catch(() => {
				// Aborted on destroy while still waiting.
			})
	} else {
		lead()
	}

	return {
		destroy: () => {
			if (destroyed) return
			destroyed = true
			post({ from: id, kind: 'bye' })
			source?.destroy()
			lockAbort.abort()
			releaseLock?.()
			channel?.close()
			fallback.destroy()
		},
		notify: (keys) => post({ from: id, keys, kind: 'changed' }),
		setActive: (key, active) => fallback.setActive(key, active),
		watch: (entries, since) => {
			own = entries
			ownSince = since
			setUp(up)
			if (source) follow()
			else post({ entries, from: id, kind: 'watch' })
		},
	}
}
