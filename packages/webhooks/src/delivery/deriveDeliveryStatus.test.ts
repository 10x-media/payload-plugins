import { describe, expect, it } from 'vitest'
import { deriveDeliveryStatus } from './deriveDeliveryStatus'

describe('deriveDeliveryStatus', () => {
	it('success when ok', () => {
		expect(deriveDeliveryStatus({ ok: true, attempt: 1, maxRetries: 4 })).toBe('success')
	})
	it('failed while retries remain', () => {
		expect(deriveDeliveryStatus({ ok: false, attempt: 1, maxRetries: 4 })).toBe('failed')
		expect(deriveDeliveryStatus({ ok: false, attempt: 4, maxRetries: 4 })).toBe('failed')
	})
	it('dead once attempts exceed maxRetries (final try)', () => {
		expect(deriveDeliveryStatus({ ok: false, attempt: 5, maxRetries: 4 })).toBe('dead')
		expect(deriveDeliveryStatus({ ok: false, attempt: 1, maxRetries: 0 })).toBe('dead')
	})
})
