import { ConversationsRequestError } from './api'
import { browserPollerEnv, type PollerEnv } from './poller'
import {
	type ConversationsClientTransport,
	pollingTransport,
	type TransportConnectArgs,
	type TransportConnection,
} from './transport'

/** What tabs tell each other about one instance's stream. Same origin, one channel per instance. */
type Message =
	/** A tab's watched keys and their tokens, for the tab holding the stream. */
	| { entries: Array<{ key: string; token: string }>; from: string; kind: 'watch' }
	/** The stream's news, or a tab's own action: these keys changed. */
	| { from: string; keys: string[]; kind: 'changed' }
	/** Tokens of these keys ran out: their tabs renew them. */
	| { from: string; keys: string[]; kind: 'expired' }
	/** Whether the stream is up; while it is not, every tab polls its own keys. */
	| { from: string; kind: 'health'; up: boolean }
	/** A new stream holder asks every tab for its keys. */
	| { from: string; kind: 'hello' }
	| { from: string; kind: 'bye' }

/** Waits between reconnects, then the last one repeats. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]
/** Watch changes within this window reconnect once. */
const RECONNECT_DEBOUNCE_MS = 250

/** Server-Sent Events from a fetch body: `event:` and `data:` lines, blocks split by a blank line. */
export const parseEvents = (
	buffer: string
): { events: Array<{ data: string; event: string }>; rest: string } => {
	const events: Array<{ data: string; event: string }> = []
	const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
	const rest = blocks.pop() ?? ''
	for (const block of blocks) {
		let event = 'message'
		const data: string[] = []
		for (const line of block.split('\n')) {
			if (line.startsWith(':')) continue
			if (line.startsWith('event:')) event = line.slice(6).trim()
			else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
		}
		if (data.length > 0) events.push({ data: data.join('\n'), event })
	}
	return { events, rest }
}

/**
 * Realtime over the server's `sseTransport()`: changes arrive the moment they
 * are written instead of on the next poll.
 *
 * One tab per browser holds the stream for every tab (a Web Lock picks it;
 * the others send it their keys and hear its news over a `BroadcastChannel`),
 * so ten open tabs are one connection. The stream resumes where it left off
 * after a drop, backing off between tries. While it is down, or when the
 * server has no stream (404), each tab falls back to `fallback` (default
 * `pollingTransport()`), which runs only then.
 */
export const sseClientTransport = (
	options: { env?: () => PollerEnv; fallback?: ConversationsClientTransport } = {}
): ConversationsClientTransport => ({
	connect: (args) =>
		createStreamer({
			...args,
			env: (options.env ?? browserPollerEnv)(),
			fallback: (options.fallback ?? pollingTransport()).connect(args),
		}),
})

export const createStreamer = ({
	env,
	events,
	fallback,
	instance,
	onChange,
	onExpired,
}: TransportConnectArgs & {
	env: PollerEnv
	fallback: TransportConnection
}): TransportConnection => {
	const id = Math.random().toString(36).slice(2)
	const shared = Boolean(env.locks && env.openChannel)
	const channel = shared ? (env.openChannel?.(`conversations:${instance}:stream`) ?? null) : null
	/** This tab's keys and tokens, and the server time they were issued at. */
	let own = new Map<string, string>()
	let ownSince: null | string = null
	const peers = new Map<string, Map<string, string>>()
	let up = false
	let leading = false
	let destroyed = false
	let releaseLock: (() => void) | null = null
	const lockAbort = new AbortController()
	/** The open stream, if this tab holds it. */
	let stream: AbortController | null = null
	/** Server time of the last news, where a reconnect resumes. */
	let lastAt: null | string = null
	let failures = 0
	/** The server has no stream: stop trying for this page's life. */
	let unsupported = false
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined

	const post = (message: Message) => channel?.postMessage(message)

	const ownEntries = () => [...own].map(([key, token]) => ({ key, token }))

	/** Poll only while the stream is down, so the two never both run. */
	const setUp = (next: boolean) => {
		up = next
		fallback.watch(up ? [] : ownEntries(), ownSince ?? new Date(env.now()).toISOString())
	}

	const hearChanged = (keys: string[]) => {
		const mine = keys.filter((key) => own.has(key))
		if (mine.length > 0) onChange(mine)
	}

	const hearExpired = (keys: string[]) => {
		const mine = keys.filter((key) => own.has(key))
		if (mine.length > 0) onExpired(mine)
	}

	/** Every tab's keys; the newest token wins for a key two tabs follow. */
	const union = () => {
		const all = new Map<string, string>()
		for (const entries of peers.values()) for (const [key, token] of entries) all.set(key, token)
		for (const [key, token] of own) all.set(key, token)
		return all
	}

	const announce = (next: boolean) => {
		setUp(next)
		post({ from: id, kind: 'health', up: next })
	}

	const open = async () => {
		reconnectTimer = undefined
		stream?.abort()
		stream = null
		if (destroyed || !leading || unsupported) return
		const watched = union()
		if (watched.size === 0) return
		const controller = new AbortController()
		stream = controller
		const tokenToKey = new Map([...watched].map(([key, token]) => [token, key]))
		try {
			const res = await events(
				{ since: lastAt ?? ownSince ?? undefined, tokens: [...watched.values()] },
				controller.signal
			)
			const reader = res.body?.getReader()
			if (!reader) throw new Error('No stream')
			const decoder = new TextDecoder()
			let buffer = ''
			for (;;) {
				const { done, value } = await reader.read()
				if (done) break
				buffer += decoder.decode(value, { stream: true })
				const parsed = parseEvents(buffer)
				buffer = parsed.rest
				for (const { data, event } of parsed.events) {
					const payload = JSON.parse(data) as { at?: string; expired?: string[]; keys?: string[] }
					if (payload.at) lastAt = payload.at
					if (event === 'ready') {
						failures = 0
						announce(true)
						const expired = (payload.expired ?? []).flatMap((token) => {
							const key = tokenToKey.get(token)
							return key ? [key] : []
						})
						if (expired.length > 0) {
							hearExpired(expired)
							post({ from: id, keys: expired, kind: 'expired' })
						}
					} else if (event === 'changed' && payload.keys) {
						hearChanged(payload.keys)
						post({ from: id, keys: payload.keys, kind: 'changed' })
					} else if (event === 'expired' && payload.keys) {
						hearExpired(payload.keys)
						post({ from: id, keys: payload.keys, kind: 'expired' })
					}
				}
			}
		} catch (error) {
			if (controller.signal.aborted) return
			if (error instanceof ConversationsRequestError && error.status === 404) {
				unsupported = true
			}
		}
		if (stream !== controller || destroyed) return
		stream = null
		announce(false)
		if (unsupported) return
		const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000
		failures++
		reconnectTimer = env.setTimeout(() => void open(), wait)
	}

	/** Reconnect soon with the current keys; several changes in a row make one reconnect. */
	const reconnect = () => {
		if (!leading || destroyed || unsupported) return
		if (reconnectTimer) env.clearTimeout(reconnectTimer)
		reconnectTimer = env.setTimeout(() => void open(), RECONNECT_DEBOUNCE_MS)
	}

	const lead = () => {
		leading = true
		post({ from: id, kind: 'hello' })
		reconnect()
	}

	if (channel) {
		channel.onmessage = (event: MessageEvent) => {
			const message = event.data as Message
			if (!message || message.from === id) return
			switch (message.kind) {
				case 'watch':
					peers.set(message.from, new Map(message.entries.map((entry) => [entry.key, entry.token])))
					reconnect()
					return
				case 'changed':
					hearChanged(message.keys)
					return
				case 'expired':
					hearExpired(message.keys)
					return
				case 'health':
					if (!leading) setUp(message.up)
					return
				case 'hello':
					post({ entries: ownEntries(), from: id, kind: 'watch' })
					if (!leading) setUp(false)
					return
				case 'bye':
					if (peers.delete(message.from)) reconnect()
					return
			}
		}
	}

	if (shared && env.locks) {
		env.locks
			.request(`conversations:${instance}:stream`, { signal: lockAbort.signal }, () => {
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
			stream?.abort()
			if (reconnectTimer) env.clearTimeout(reconnectTimer)
			lockAbort.abort()
			releaseLock?.()
			channel?.close()
			fallback.destroy()
		},
		notify: (keys) => post({ from: id, keys, kind: 'changed' }),
		setActive: (key, active) => fallback.setActive(key, active),
		watch: (entries, since) => {
			own = new Map(entries.map((entry) => [entry.key, entry.token]))
			ownSince = since
			setUp(up)
			if (leading) reconnect()
			else post({ entries, from: id, kind: 'watch' })
		},
	}
}
