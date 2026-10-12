import { describe, expect, it } from 'vitest'
import { DEFAULT_ROTATION_GRACE_SECONDS } from './constants'
import { resolveDeliveryOptions, resolveSecretRotationOptions } from './options'

describe('resolveDeliveryOptions', () => {
	it('defaults when undefined', () => {
		expect(resolveDeliveryOptions(undefined)).toEqual({
			mode: 'auto',
			timeoutMs: 10_000,
			retries: 4,
			queue: 'default',
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
			queue: 'default',
		})
	})
})

describe('resolveSecretRotationOptions', () => {
	it('defaults the grace period', () => {
		expect(resolveSecretRotationOptions(undefined).graceSeconds).toBe(
			DEFAULT_ROTATION_GRACE_SECONDS
		)
		expect(resolveSecretRotationOptions({}).graceSeconds).toBe(DEFAULT_ROTATION_GRACE_SECONDS)
	})

	it('accepts an explicit grace period, including zero', () => {
		expect(resolveSecretRotationOptions({ graceSeconds: 60 }).graceSeconds).toBe(60)
		expect(resolveSecretRotationOptions({ graceSeconds: 0 }).graceSeconds).toBe(0)
	})

	it('rejects a negative or non-finite grace period', () => {
		expect(() => resolveSecretRotationOptions({ graceSeconds: -1 })).toThrow(/non-negative/)
		expect(() => resolveSecretRotationOptions({ graceSeconds: Number.NaN })).toThrow(/non-negative/)
	})
})
