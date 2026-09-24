import type { SubscribeEntry, SubscribeResponse } from '../shared/wire'
import type { ConversationsApi } from './api'
import type { ConversationsClientTransport, TransportConnection } from './transport'
import type { WindowMessage } from './window'

/** Everything a provider knows about the instance, from the last subscribe. */
export type InstanceMeta = Omit<SubscribeResponse, 'entries' | 'now'>

/** A local event for the windows showing one conversation. */
export type LocalEvent =
	| { message: WindowMessage; type: 'confirmed' | 'optimistic' }
	| { clientId: string; type: 'failed' }

/** Renew tokens (and unread counts) this long before they expire. */
const RENEW_MS = 8 * 60 * 1000

/**
 * The provider's state outside React: which keys are mounted, their access and
 * unread counts, the transport connection, and the event fan-out to windows.
 * Hooks read it through `useSyncExternalStore`.
 *
 * Mounts coalesce: every key retained within one tick goes out in a single
 * `subscribe` request, so a list with 25 triggers sends one.
 */
export class ConversationsStore {
	readonly api: ConversationsApi
	readonly instance: string
	meta: InstanceMeta | null = null
	version = 0

	private readonly transport: ConversationsClientTransport
	private connection: TransportConnection | null = null
	private readonly refs = new Map<string, number>()
	private readonly entries = new Map<string, SubscribeEntry>()
	private readonly failed = new Map<string, Error>()
	private readonly active = new Map<string, number>()
	private readonly listeners = new Set<() => void>()
	private readonly changeListeners = new Map<string, Set<() => void>>()
	private readonly localListeners = new Map<string, Set<(event: LocalEvent) => void>>()
	private queue = new Set<string>()
	private flushing = false
	private since: null | string = null
	private renewTimer: ReturnType<typeof setTimeout> | undefined

	constructor(args: {
		api: ConversationsApi
		instance: string
		transport: ConversationsClientTransport
	}) {
		this.api = args.api
		this.instance = args.instance
		this.transport = args.transport
	}

	/** Open the transport connection. Idempotent; pairs with `disconnect`. */
	connect(): void {
		if (this.connection) return
		this.connection = this.transport.connect({
			instance: this.instance,
			onChange: (keys) => this.changed(keys),
			onExpired: (keys) => this.request(keys),
			poll: (body) => this.api.poll(body),
		})
		this.watch()
		for (const [key, count] of this.active) {
			if (count > 0) this.connection.setActive(key, true)
		}
	}

	disconnect(): void {
		this.connection?.destroy()
		this.connection = null
		if (this.renewTimer) clearTimeout(this.renewTimer)
		this.renewTimer = undefined
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	getVersion = (): number => this.version

	entry(key: string): SubscribeEntry | undefined {
		return this.entries.get(key)
	}

	error(key: string): Error | undefined {
		return this.failed.get(key)
	}

	/** Mount a key; returns its release. */
	retain(key: string): () => void {
		this.refs.set(key, (this.refs.get(key) ?? 0) + 1)
		if (!this.entries.has(key)) this.request([key])
		return () => {
			const count = (this.refs.get(key) ?? 1) - 1
			if (count > 0) {
				this.refs.set(key, count)
				return
			}
			this.refs.delete(key)
			// Kept for a tick so an unmount followed by a remount does not refetch.
			queueMicrotask(() => {
				if (this.refs.has(key)) return
				this.entries.delete(key)
				this.failed.delete(key)
				this.watch()
			})
		}
	}

	/** A feed of the key is open (`true`) or closed; counted across mounts. */
	setActive(key: string, active: boolean): void {
		const count = Math.max(0, (this.active.get(key) ?? 0) + (active ? 1 : -1))
		this.active.set(key, count)
		if (count > 0 === active) this.connection?.setActive(key, active)
	}

	/** Re-subscribe keys: fresh unread counts and tokens. Coalesced within a tick. */
	request(keys: string[]): void {
		for (const key of keys) this.queue.add(key)
		if (this.flushing) return
		this.flushing = true
		queueMicrotask(() => void this.flush())
	}

	/** Called after this tab's own action on `keys`: refresh here, tell other tabs. */
	touched(keys: string[]): void {
		this.request(keys)
		this.connection?.notify(keys)
	}

	onChange(key: string, listener: () => void): () => void {
		const set = this.changeListeners.get(key) ?? new Set()
		set.add(listener)
		this.changeListeners.set(key, set)
		return () => set.delete(listener)
	}

	onLocal(key: string, listener: (event: LocalEvent) => void): () => void {
		const set = this.localListeners.get(key) ?? new Set()
		set.add(listener)
		this.localListeners.set(key, set)
		return () => set.delete(listener)
	}

	emitLocal(key: string, event: LocalEvent): void {
		for (const listener of this.localListeners.get(key) ?? []) listener(event)
	}

	private changed(keys: string[]): void {
		for (const key of keys) {
			for (const listener of this.changeListeners.get(key) ?? []) listener()
		}
		this.request(keys)
	}

	private async flush(): Promise<void> {
		const keys = [...this.queue].filter((key) => this.refs.has(key))
		this.queue = new Set()
		this.flushing = false
		if (keys.length === 0) return
		try {
			const response = await this.api.subscribe(keys)
			const { entries, now, ...meta } = response
			this.meta = meta
			this.since ??= now
			const allowed = new Set(entries.map((entry) => entry.key))
			for (const entry of entries) {
				this.entries.set(entry.key, entry)
				this.failed.delete(entry.key)
			}
			for (const key of keys) {
				if (!allowed.has(key)) {
					this.entries.delete(key)
					this.failed.set(key, new Error('Not found'))
				}
			}
			this.watch()
			this.scheduleRenewal()
		} catch (error) {
			for (const key of keys) {
				this.failed.set(key, error instanceof Error ? error : new Error(String(error)))
			}
		}
		this.emit()
	}

	private watch(): void {
		if (!this.connection || !this.since) return
		this.connection.watch(
			[...this.entries.values()].map((entry) => ({ key: entry.key, token: entry.token })),
			this.since
		)
	}

	private scheduleRenewal(): void {
		if (this.renewTimer) return
		this.renewTimer = setTimeout(() => {
			this.renewTimer = undefined
			this.request([...this.refs.keys()])
		}, RENEW_MS)
	}

	private emit(): void {
		this.version++
		for (const listener of this.listeners) listener()
	}
}
