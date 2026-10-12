import type { Payload } from 'payload'

/** Set on an instance once `payload.destroy()` was called on it. */
const DESTROYED_KEY = Symbol.for('@10x-media/analytics/destroyed')

/** Set on an instance whose `destroy` already closes what the plugin holds. */
const HOOKED_KEY = Symbol.for('@10x-media/analytics/destroy-hook')

/** What an instance runs once its `destroy` finished, one entry per key. */
const AFTER_KEY = Symbol.for('@10x-media/analytics/after-destroy')

/** Whether `payload.destroy()` was called on the instance: nothing of the plugin may start on it. */
export const isDestroyed = (payload: Payload): boolean =>
	Reflect.get(payload, DESTROYED_KEY) === true

/**
 * Runs `close` once when `payload.destroy()` is first called, before Payload stops crons and its
 * adapter, so running work finishes on an open connection. HMR `reload` never reaches it.
 */
export const onDestroy = (payload: Payload, close: () => Promise<void>): void => {
	if (Reflect.get(payload, HOOKED_KEY) === true) {
		return
	}
	const original = payload.destroy
	if (typeof original !== 'function') {
		return
	}
	Reflect.set(payload, HOOKED_KEY, true)
	let closing: Promise<void> | undefined
	payload.destroy = async () => {
		Reflect.set(payload, DESTROYED_KEY, true)
		closing ??= close().catch((err: unknown) => {
			payload.logger?.warn(
				`analytics: closing what the plugin holds as Payload shut down failed: ${String(err)}`
			)
		})
		await closing
		await original.call(payload)
	}
}

/**
 * Runs `close` once `payload.destroy()` finished, `onDestroy` work included, for what the engine's
 * last statement still needs (SQLite worker threads). One `close` per `key`.
 */
export const afterDestroy = (payload: Payload, key: object, close: () => Promise<void>): void => {
	const held: unknown = Reflect.get(payload, AFTER_KEY)
	if (held instanceof Map) {
		if (!held.has(key)) {
			held.set(key, close)
		}
		return
	}
	const original = payload.destroy
	if (typeof original !== 'function') {
		return
	}
	const closers = new Map<object, () => Promise<void>>([[key, close]])
	Reflect.set(payload, AFTER_KEY, closers)
	payload.destroy = async () => {
		try {
			await original.call(payload)
		} finally {
			const all = [...closers.values()]
			closers.clear()
			await Promise.all(
				all.map((each) =>
					each().catch((err: unknown) => {
						payload.logger?.warn(
							`analytics: closing what the plugin holds after Payload shut down failed: ${String(err)}`
						)
					})
				)
			)
		}
	}
}
