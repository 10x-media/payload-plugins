import type { Payload } from 'payload'
import { nativeInstanceOf } from '../native/engine/instance'
import { builtRuntime } from '../plugin/runtime'

/**
 * Waits until the plugin's background work on `payload` is done (cache writes, native upkeep, the
 * write buffer, which it flushes), for a test before it reads back or calls `payload.destroy()`.
 */
export const settleAnalytics = async (payload: Payload): Promise<void> => {
	const native = nativeInstanceOf(payload)
	await Promise.all([
		builtRuntime(payload)?.engine.idle?.(),
		native?.engine.idle(),
		native?.writer.flush(),
	])
}
