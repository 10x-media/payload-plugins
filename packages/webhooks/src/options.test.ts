import { describe, expect, it } from 'vitest'
import { resolveDeliveryOptions } from './options'

describe('resolveDeliveryOptions', () => {
	it('defaults when undefined', () => {
		expect(resolveDeliveryOptions(undefined)).toEqual({
			mode: 'auto',
			timeoutMs: 10_000,
			retries: 4,
			queue: 'webhooks',
		})
	})

	it('accepts a string shorthand as the mode', () => {
		expect(resolveDeliveryOptions('inline').mode).toBe('inline')
	})

	it('merges an object over defaults', () => {
		expect(resolveDeliveryOptions({ mode: 'queue', timeoutMs: 500 })).toEqual({
			mode: 'queue',
			timeoutMs: 500,
			retries: 4,
			queue: 'webhooks',
		})
	})
})
