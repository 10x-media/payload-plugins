import { describe, expect, it } from 'vitest'
import { ga4EventName } from './adapters/ga4'
import { createGa4Sink } from './tracker'
import { TRAFFIC_CHANNELS } from './types'

describe('public surface for the GA4 sink and traffic channels', () => {
	it('exports createGa4Sink beside the other vendor sinks', () => {
		expect(typeof createGa4Sink).toBe('function')
	})

	it('exports ga4EventName from the ga4 adapter entry', () => {
		expect(ga4EventName('sign-up')).toBe('sign_up')
	})

	it('exports the traffic channels a native source row can hold', () => {
		expect(TRAFFIC_CHANNELS).toContain('search')
	})
})
