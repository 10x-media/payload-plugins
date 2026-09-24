import type { PollResponse } from '../shared/wire'

/** What one tab tells the others about an instance. Same origin, one channel per instance. */
type Message =
	/** Keys that changed, and the server time the check ran at. */
	| { at: string; changed: string[]; from: string; keys: string[]; kind: 'polled' }
	/** A tab's own action changed these keys: peers refetch without waiting for a poll. */
	| { from: string; keys: string[]; kind: 'changed' }
	/** Keys with a feed open in the sending tab; their leader polls faster. */
	| { from: string; keys: string[]; kind: 'active' }
	| { from: string; kind: 'hello' }
	| { from: string; kind: 'bye' }

type Channel = Pick<BroadcastChannel, 'close' | 'postMessage'> & {
	onmessage: ((event: MessageEvent) => void) | null
}

/** The browser, passed in so the poller can be tested without one. */
export type PollerEnv = {
	clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
	isVisible: () => boolean
	/** `navigator.locks`, when the browser has it. */
	locks?: Pick<LockManager, 'request'>
	now: () => number
	onVisibilityChange: (listener: () => void) => () => void
	/** Opens a channel, when the browser has `BroadcastChannel`. */
	openChannel?: (name: string) => Channel
	setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
}

export type PollerIntervals = {
	/** While a feed of the key is open in any tab. Default 15 s. */
	active: number
	/** While only triggers show the key. Default 60 s. */
	idle: number
}

export type Poller = {
	/** Mark a key as shown in an open feed here (`true`) or not any more. */
	setActive: (key: string, active: boolean) => void
	/** Tell the other tabs these keys changed through this tab's own action. */
	notify: (keys: string[]) => void
	/** Replace the watched keys and their tokens; `since` is the server time they were issued at. */
	watch: (entries: Array<{ key: string; token: string }>, since: string) => void
	destroy: () => void
}

type KeyState = {
	/** Aborts a lock request still waiting for its turn. */
	abort: AbortController | null
	leading: boolean
	/** Server time of the last check anyone made for this key. */
	polledAt: string
	/** Local time of that check, for scheduling. */
	polledLocal: number
	release: (() => void) | null
	token: string
}

/**
 * Polls an instance's watched keys, once per browser per key, however many tabs
 * show them.
 *
 * Each key has a Web Lock (`conversations:<instance>:<key>`). A visible tab
 * asks for the locks of the keys it shows and lets them go when hidden, so a
 * key is polled by exactly one tab someone can see, and by nobody when no tab
 * is visible. The browser releases a closed tab's locks, and a waiting tab
 * takes over. A tab polls every key it leads in one request per tick.
 *
 * Results go to every tab over a `BroadcastChannel`, so a tab that does not
 * lead a key still hears that it changed, and a new leader keeps the old one's
 * clock rather than polling on arrival. Modelled on a notifications poller
 * that leads for a single summary; here leadership is per key.
 *
 * Without Web Locks or `BroadcastChannel` each visible tab polls its own keys.
 */
export const createPoller = ({
	env,
	instance,
	intervals,
	onChange,
	onExpired,
	poll,
}: {
	env: PollerEnv
	instance: string
	intervals: PollerIntervals
	onChange: (keys: string[]) => void
	/** Tokens the server refused: the caller renews them through `subscribe`. */
	onExpired: (keys: string[]) => void
	poll: (body: { since: string; tokens: string[] }) => Promise<PollResponse>
}): Poller => {
	const id = Math.random().toString(36).slice(2)
	const shared = Boolean(env.locks && env.openChannel)
	const channel = shared ? (env.openChannel?.(`conversations:${instance}`) ?? null) : null
	const keys = new Map<string, KeyState>()
	const ownActive = new Set<string>()
	const peerActive = new Map<string, Set<string>>()
	let timer: ReturnType<typeof setTimeout> | undefined
	let inFlight = false
	let destroyed = false

	const post = (message: Message) => channel?.postMessage(message)

	const isActive = (key: string) =>
		ownActive.has(key) || [...peerActive.values()].some((set) => set.has(key))

	const dueAt = (key: string, state: KeyState) =>
		state.polledLocal + (isActive(key) ? intervals.active : intervals.idle)

	const reschedule = () => {
		if (timer) env.clearTimeout(timer)
		timer = undefined
		if (destroyed || inFlight) return
		let next = Number.POSITIVE_INFINITY
		for (const [key, state] of keys) {
			if (state.leading) next = Math.min(next, dueAt(key, state))
		}
		if (next === Number.POSITIVE_INFINITY) return
		timer = env.setTimeout(() => void tick(), Math.max(0, next - env.now()))
	}

	/** A check for `checked` ran at server time `at`; `changed` of them moved. */
	const record = ({
		at,
		changed,
		checked,
		local,
	}: {
		at: string
		changed: string[]
		checked: string[]
		local: number
	}) => {
		for (const key of checked) {
			const state = keys.get(key)
			if (state && (!state.polledAt || state.polledAt < at)) {
				state.polledAt = at
				state.polledLocal = local
			}
		}
		const mine = changed.filter((key) => keys.has(key))
		if (mine.length > 0) onChange(mine)
	}

	const tick = async () => {
		timer = undefined
		if (destroyed) return
		const now = env.now()
		const due = [...keys].filter(([key, state]) => state.leading && dueAt(key, state) <= now)
		if (due.length === 0) {
			reschedule()
			return
		}
		inFlight = true
		const since = due.reduce(
			(earliest, [, state]) => (state.polledAt < earliest ? state.polledAt : earliest),
			due[0]?.[1].polledAt ?? new Date(now).toISOString()
		)
		const checked = due.map(([key]) => key)
		try {
			const result = await poll({ since, tokens: due.map(([, state]) => state.token) })
			if (destroyed) return
			const expired = due
				.filter(([, state]) => result.expired.includes(state.token))
				.map(([key]) => key)
			record({ at: result.now, changed: result.changed, checked, local: env.now() })
			post({ at: result.now, changed: result.changed, from: id, keys: checked, kind: 'polled' })
			if (expired.length > 0) onExpired(expired)
		} catch {
			// A failed poll still counts as one, or a server that is down would be asked in a loop.
			for (const key of checked) {
				const state = keys.get(key)
				if (state) state.polledLocal = env.now()
			}
		} finally {
			inFlight = false
			reschedule()
		}
	}

	const lead = (state: KeyState) => {
		state.leading = true
		reschedule()
	}

	const stepDown = (state: KeyState) => {
		state.leading = false
		state.release?.()
		state.release = null
		state.abort?.abort()
		state.abort = null
	}

	const seek = (key: string, state: KeyState) => {
		if (destroyed || state.leading || state.abort || !env.isVisible()) return
		if (!shared || !env.locks) {
			lead(state)
			return
		}
		const controller = new AbortController()
		state.abort = controller
		env.locks
			.request(`conversations:${instance}:${key}`, { signal: controller.signal }, () => {
				state.abort = null
				if (destroyed || !env.isVisible() || keys.get(key) !== state) return undefined
				lead(state)
				// Held until this tab steps down: hidden, unwatched, destroyed, or closed.
				return new Promise<void>((resolve) => {
					state.release = resolve
				})
			})
			.catch(() => {
				// Aborted before its turn came (hidden or unwatched): nothing to do.
			})
	}

	const onVisibility = () => {
		for (const [key, state] of keys) {
			if (env.isVisible()) seek(key, state)
			else stepDown(state)
		}
		reschedule()
	}

	if (channel) {
		channel.onmessage = (event: MessageEvent) => {
			const message = event.data as Message
			if (!message || message.from === id) return
			switch (message.kind) {
				case 'polled':
					record({
						at: message.at,
						changed: message.changed,
						checked: message.keys,
						local: env.now(),
					})
					reschedule()
					return
				case 'changed': {
					const mine = message.keys.filter((key) => keys.has(key))
					if (mine.length > 0) onChange(mine)
					return
				}
				case 'active':
					if (message.keys.length > 0) peerActive.set(message.from, new Set(message.keys))
					else peerActive.delete(message.from)
					reschedule()
					return
				case 'hello':
					if (ownActive.size > 0) post({ from: id, keys: [...ownActive], kind: 'active' })
					return
				case 'bye':
					peerActive.delete(message.from)
					reschedule()
					return
			}
		}
		post({ from: id, kind: 'hello' })
	}

	const stopWatching = env.onVisibilityChange(onVisibility)

	return {
		destroy: () => {
			if (destroyed) return
			post({ from: id, kind: 'bye' })
			for (const state of keys.values()) stepDown(state)
			destroyed = true
			if (timer) env.clearTimeout(timer)
			stopWatching()
			channel?.close()
		},
		notify: (changed) => post({ from: id, keys: changed, kind: 'changed' }),
		setActive: (key, active) => {
			const had = ownActive.has(key)
			if (active === had) return
			if (active) ownActive.add(key)
			else ownActive.delete(key)
			post({ from: id, keys: [...ownActive], kind: 'active' })
			reschedule()
		},
		watch: (entries, since) => {
			const next = new Map(entries.map((entry) => [entry.key, entry.token]))
			for (const [key, state] of keys) {
				if (!next.has(key)) {
					stepDown(state)
					keys.delete(key)
				}
			}
			const local = env.now()
			for (const [key, token] of next) {
				const existing = keys.get(key)
				if (existing) {
					existing.token = token
					continue
				}
				const state: KeyState = {
					abort: null,
					leading: false,
					polledAt: since,
					polledLocal: local,
					release: null,
					token,
				}
				keys.set(key, state)
				seek(key, state)
			}
			reschedule()
		},
	}
}

/** The poller's view of the real browser. */
export const browserPollerEnv = (): PollerEnv => ({
	clearTimeout: (timer) => clearTimeout(timer),
	isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
	locks: typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : undefined,
	now: () => Date.now(),
	onVisibilityChange: (listener) => {
		if (typeof document === 'undefined') return () => undefined
		document.addEventListener('visibilitychange', listener)
		return () => document.removeEventListener('visibilitychange', listener)
	},
	openChannel:
		typeof BroadcastChannel !== 'undefined' ? (name) => new BroadcastChannel(name) : undefined,
	setTimeout: (callback, ms) => setTimeout(callback, ms),
})
