import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { orderRefKey, signOrderId, wireOrderId } from './orderSignature'
import { MAX_ORDER_ID_LENGTH } from './revenue'

const payload = { secret: 'top-secret' } as unknown as Payload
const key = orderRefKey('top-secret')

describe('signOrderId', () => {
	it('signs an order id for its scope, the signature after an @', () => {
		const signed = signOrderId(payload, 'ord_42', { scope: 'tenant-a' })
		expect(signed).toMatch(/^ord_42@[A-Za-z0-9_-]{12}$/)
		expect(signOrderId(payload, 'ord_42', { scope: 'tenant-a' })).toBe(signed)
		expect(signOrderId(payload, 'ord_42', { scope: 'tenant-b' })).not.toBe(signed)
		expect(signOrderId(payload, 'ord_42')).toBe(signOrderId(payload, 'ord_42', { scope: null }))
	})

	it('signs nothing that is no order id, and nothing without a secret', () => {
		expect(signOrderId(payload, 'x'.repeat(MAX_ORDER_ID_LENGTH + 1))).toBeUndefined()
		expect(signOrderId(payload, ' ')).toBeUndefined()
		expect(signOrderId({ secret: '' } as unknown as Payload, 'ord_42')).toBeUndefined()
	})
})

describe('wireOrderId', () => {
	const signed = signOrderId(payload, 'ord_42@shop', { scope: 's' }) ?? ''

	it('takes the id out of a reference signed for the scope, whatever the mode', () => {
		for (const mode of ['required', 'optional'] as const) {
			expect(wireOrderId(signed, 's', { mode, key })).toEqual({ ok: true, orderId: 'ord_42@shop' })
		}
	})

	it('refuses an unsigned id, or one signed for another scope, when signatures are required', () => {
		expect(wireOrderId('ord_42', 's', { mode: 'required', key })).toEqual({ ok: false })
		expect(wireOrderId(signed, 'other', { mode: 'required', key })).toEqual({ ok: false })
		expect(wireOrderId(signed, 's', { mode: 'required' })).toEqual({ ok: false })
	})

	it('takes an unsigned id as it stands while they are optional, and a bad signature as part of it', () => {
		expect(wireOrderId('ord_42', 's', { mode: 'optional', key })).toEqual({
			ok: true,
			orderId: 'ord_42',
		})
		expect(wireOrderId(signed, 'other', { mode: 'optional', key })).toEqual({
			ok: true,
			orderId: signed,
		})
		expect(wireOrderId('ord_42', 's', undefined)).toEqual({ ok: true, orderId: 'ord_42' })
	})

	it('refuses what is no order id, and leaves an absent one absent', () => {
		for (const value of ['', 'x'.repeat(MAX_ORDER_ID_LENGTH + 1), 'a\nb', 42, null]) {
			expect(wireOrderId(value, 's', { mode: 'optional', key })).toEqual({ ok: false })
		}
		expect(wireOrderId(undefined, 's', { mode: 'required', key })).toEqual({ ok: true })
	})
})
