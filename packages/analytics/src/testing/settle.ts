import type { Payload } from 'payload'
import { nativeInstanceOf } from '../native/engine/instance'
import { builtRuntime } from '../plugin/runtime'

/**
 * Waits until the plugin's background work on `payload` is done (cache writes, native upkeep, the
 * write buffer, which it flushes, connection checks and status writes), for a test before it reads
 * back or calls `payload.destroy()`.
 */
export const settleAnalytics = async (payload: Payload): Promise<void> => {
	const native = nativeInstanceOf(payload)
	const runtime = builtRuntime(payload)
	// In order: a read that settles queues a status write, and a check finishing queues one too.
	await Promise.all([runtime?.engine.idle?.(), native?.engine.idle(), native?.writer.flush()])
	await runtime?.providerRecheck?.idle()
	await runtime?.providerStatus?.idle()
}
