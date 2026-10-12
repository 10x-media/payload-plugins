import type { Payload } from 'payload'
import { hasMethods, isRecord } from '../../core/values'
import type { ItemIngestOptions } from '../ingest/normalizeEvent'
import type { OrderSignatureCheck } from '../ingest/orderSignature'
import type { EventStore, StateStore } from '../store/types'
import type { NativeEngine } from './engine'
import type { DailySalts } from './salt'
import type { SiteHosts } from './siteHosts'
import type { HitWriter } from './writeBuffer'

/**
 * Everything the native engine holds for one Payload instance; nothing of it is shared with another
 * instance, even one built from the same config.
 */
export interface NativeInstance {
	/** The adapter registration it was built from: a later registration builds a new one. */
	readonly registration: object
	readonly store: EventStore
	readonly state: StateStore
	readonly engine: NativeEngine
	readonly salts: DailySalts
	readonly writer: HitWriter
	/** The collections bound as items, with their id types and the key signatures are checked by. */
	readonly items: ItemIngestOptions | undefined
	/** How a page's order id is checked: `revenue.orderSignature` and the key it is signed with. */
	readonly orders?: OrderSignatureCheck
	/** Keeps ingest's work past the response that started it, where Next's `after()` is there. */
	readonly keepAlive?: (work: Promise<unknown>) => void
	/** One writer at a time: a server hit recorded inside a host transaction waits for it to end. */
	readonly sqlite: boolean
	/** What ingest calls after storing a hit: the engine's maintenance nudge. */
	readonly nudge: () => void
	/** The hostnames each scope records hits under, which ingest reads referrers against. */
	readonly siteHosts: SiteHosts
	/** Releases what the stores run on (SQLite's worker threads), once engine and writer settled. */
	readonly release?: () => Promise<void>
}

/** Where an instance keeps its native engine: on the instance, so every bundle copy finds it. */
const INSTANCE_KEY = Symbol.for('@10x-media/analytics/native-engine')

const isNativeInstance = (value: unknown): value is NativeInstance =>
	isRecord(value) &&
	isRecord(value.registration) &&
	typeof value.nudge === 'function' &&
	hasMethods(value.engine, ['read', 'realtime', 'idle', 'close']) &&
	hasMethods(value.writer, ['write', 'defer', 'flush', 'close']) &&
	hasMethods(value.salts, ['forHit', 'forDay'])

export const nativeInstanceOf = (payload: Payload): NativeInstance | undefined => {
	const held: unknown = Reflect.get(payload, INSTANCE_KEY)
	return isNativeInstance(held) ? held : undefined
}

/**
 * Closes an instance's engine, so it starts no more background work, settles what it still runs,
 * and writes out what its writer holds.
 */
const retireNativeInstance = async (instance: NativeInstance): Promise<void> => {
	try {
		await Promise.all([instance.engine.close(), instance.writer.close()])
	} finally {
		await instance.release?.()
	}
}

/**
 * The instance's native engine for `registration`, built when it holds none or another's (retired
 * in the background). Stored only after `build` returns, so a throwing build leaves nothing behind.
 */
export const nativeInstanceFor = (
	payload: Payload,
	registration: object,
	build: () => NativeInstance
): NativeInstance => {
	const held = nativeInstanceOf(payload)
	if (held?.registration === registration) {
		return held
	}
	const built = build()
	Reflect.set(payload, INSTANCE_KEY, built)
	if (held) {
		void retireNativeInstance(held).catch((err: unknown) => {
			payload.logger?.warn(`analytics: retiring a replaced native engine failed: ${String(err)}`)
		})
	}
	return built
}

/**
 * Retires and forgets the instance's native engine when `registration` built it, so its next use
 * starts a fresh one; an engine another registration built is left alone.
 */
export const closeNativeInstance = async (
	payload: Payload,
	registration: object
): Promise<void> => {
	const held = nativeInstanceOf(payload)
	if (held?.registration !== registration) {
		return
	}
	Reflect.deleteProperty(payload, INSTANCE_KEY)
	await retireNativeInstance(held)
}
