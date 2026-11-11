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
	await runtime?.providerRecheck?.idle()
	await Promise.all([
		runtime?.engine.idle?.(),
		runtime?.providerStatus?.idle(),
		native?.engine.idle(),
		native?.writer.flush(),
	])
}
