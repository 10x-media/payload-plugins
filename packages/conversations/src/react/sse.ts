import { ConversationsRequestError } from './api'
import { browserPollerEnv, type PollerEnv } from './poller'
import { createRelay, type RealtimeSource, type SourceHandlers } from './relay'
import {
	type ConversationsClientTransport,
	pollingTransport,
	type TransportConnectArgs,
	type WatchEntry,
} from './transport'

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
 * The stream of the server's `sseTransport()`. Reconnects with backoff after
 * a drop and resumes from the last news, so nothing is missed in between; a
 * 404 (no stream on the server) ends the tries for the page's life.
 */
export const createSseSource = ({
	env,
	events,
	handlers,
}: {
	env: Pick<PollerEnv, 'clearTimeout' | 'setTimeout'>
	events: TransportConnectArgs['events']
	handlers: SourceHandlers
}): RealtimeSource => {
	let watched: WatchEntry[] = []
	let since: null | string = null
	/** Server time of the last news, where a reconnect resumes. */
	let lastAt: null | string = null
	let stream: AbortController | null = null
	let failures = 0
	let unsupported = false
	let destroyed = false
	let timer: ReturnType<typeof setTimeout> | undefined

	const schedule = (ms: number) => {
		if (timer) env.clearTimeout(timer)
		timer = env.setTimeout(() => void open(), ms)
	}

	const open = async () => {
		timer = undefined
		stream?.abort()
		stream = null
		if (destroyed || unsupported || watched.length === 0) return
		const controller = new AbortController()
		stream = controller
		const tokenToKey = new Map(watched.map((entry) => [entry.token, entry.key]))
		try {
			const res = await events(
				{ since: lastAt ?? since ?? undefined, tokens: watched.map((entry) => entry.token) },
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
						handlers.health(true)
						const expired = (payload.expired ?? []).flatMap((token) => {
							const key = tokenToKey.get(token)
							return key ? [key] : []
						})
						if (expired.length > 0) handlers.expired(expired)
					} else if (event === 'changed' && payload.keys) {
						handlers.changed(payload.keys)
					} else if (event === 'expired' && payload.keys) {
						handlers.expired(payload.keys)
					}
				}
			}
		} catch (error) {
			if (controller.signal.aborted) return
			if (error instanceof ConversationsRequestError && error.status === 404) unsupported = true
		}
		if (stream !== controller || destroyed) return
		stream = null
		handlers.health(false)
		if (unsupported) return
		schedule(BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)] ?? 30_000)
		failures++
	}

	return {
		destroy: () => {
			destroyed = true
			stream?.abort()
			if (timer) env.clearTimeout(timer)
		},
		watch: (entries, from) => {
			watched = entries
			since = from
			// Several changes in a row make one reconnect.
			if (!unsupported) schedule(RECONNECT_DEBOUNCE_MS)
		},
	}
}

/**
 * Realtime over the server's `sseTransport()`: changes arrive the moment they
 * are written instead of on the next poll. One tab per browser holds the
 * stream for all of them (see `createRelay`); while it is down, or when the
 * server has no stream, each tab falls back to `fallback` (default
 * `pollingTransport()`).
 */
export const sseClientTransport = (
	options: { env?: () => PollerEnv; fallback?: ConversationsClientTransport } = {}
): ConversationsClientTransport => ({
	connect: (args) => {
		const env = (options.env ?? browserPollerEnv)()
		return createRelay({
			...args,
			env,
			fallback: (options.fallback ?? pollingTransport()).connect(args),
			name: 'sse',
			open: (handlers) => createSseSource({ env, events: args.events, handlers }),
		})
	},
})
