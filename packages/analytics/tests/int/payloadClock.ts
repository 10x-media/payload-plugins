import { _internal_jobSystemGlobals, type Payload } from 'payload'
import { getRuntime } from '../../src/plugin/runtime'

let ahead = 0

/**
 * Moves Payload's clock (the read cache's expiry clock) `ms` further ahead once running cache
 * writes have stamped their entries; it never moves back, so no such entry turns fresh again.
 */
export const advancePayloadClock = async (payload: Payload, ms: number): Promise<void> => {
	await getRuntime(payload)?.engine.idle?.()
	ahead += ms
	const offset = ahead
	_internal_jobSystemGlobals.getCurrentDate = () => new Date(Date.now() + offset)
}

/** Puts Payload's clock back on real time, for a spec's `afterAll`. */
export const resetPayloadClock = (): void => {
	ahead = 0
	_internal_jobSystemGlobals.getCurrentDate = () => new Date()
}
