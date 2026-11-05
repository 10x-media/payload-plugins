import { describe, expect, it, vi } from 'vitest'
import {
	boundedValue,
	dedupeKeyFor,
	isRefund,
	MAX_EVENT_VALUE,
	MAX_ORDER_ID_LENGTH,
	orderDigestKey,
	reconcileMoney,
	sanitizeOrderId,
} from './revenue'

const at = new Date('2026-09-21T10:00:00.000Z')

describe('reconcileMoney', () => {
	it('stores and sums the amount as sent when no reporting currency is configured', async () => {
		expect(await reconcileMoney({ value: 49, currency: 'USD', at })).toEqual({
			value: 49,
			currency: 'USD',
		})
	})

	it('takes an event with no currency to be in the reporting currency', async () => {
		expect(await reconcileMoney({ value: 49, reportingCurrency: 'EUR', at })).toEqual({
			value: 49,
			currency: 'EUR',
		})
	})

	it('leaves a matching currency alone', async () => {
		expect(
			await reconcileMoney({ value: 49, currency: 'EUR', reportingCurrency: 'EUR', at })
		).toEqual({ value: 49, currency: 'EUR' })
	})

	it('converts through the hook and keeps the original beside it', async () => {
		const convertCurrency = vi.fn(async () => 42)
		expect(
			await reconcileMoney({
				value: 49,
				currency: 'USD',
				reportingCurrency: 'EUR',
				convertCurrency,
				at,
			})
		).toEqual({ value: 42, currency: 'EUR', originalValue: 49, originalCurrency: 'USD' })
		expect(convertCurrency).toHaveBeenCalledWith({ amount: 49, from: 'USD', to: 'EUR', at })
	})

	it('counts the conversion but leaves the amount out of revenue with no hook', async () => {
		const warn = vi.fn()
		expect(
			await reconcileMoney({ value: 49, currency: 'USD', reportingCurrency: 'EUR', at, warn })
		).toEqual({ value: 0, currency: 'EUR', originalValue: 49, originalCurrency: 'USD' })
		expect(warn).toHaveBeenCalledTimes(1)
	})

	it('treats a hook that throws or answers nothing exactly like a missing one', async () => {
		const thrown = await reconcileMoney({
			value: 49,
			currency: 'USD',
			reportingCurrency: 'EUR',
			convertCurrency: () => {
				throw new Error('no rate')
			},
			at,
		})
		const empty = await reconcileMoney({
			value: 49,
			currency: 'USD',
			reportingCurrency: 'EUR',
			convertCurrency: () => undefined,
			at,
		})
		expect(thrown).toEqual(empty)
		expect(thrown.value).toBe(0)
	})

	it('keeps the sent currency on an event that carries no amount', async () => {
		expect(await reconcileMoney({ currency: 'USD', reportingCurrency: 'EUR', at })).toEqual({
			currency: 'EUR',
			originalCurrency: 'USD',
		})
	})

	it('converts a refund like any other amount', async () => {
		expect(
			await reconcileMoney({
				value: -49,
				currency: 'USD',
				reportingCurrency: 'EUR',
				convertCurrency: ({ amount }) => amount * 0.9,
				at,
			})
		).toMatchObject({ value: -44.1, originalValue: -49 })
	})

	it('refuses a conversion that flips the sign, which is an answer about something else', async () => {
		expect(
			await reconcileMoney({
				value: 49,
				currency: 'USD',
				reportingCurrency: 'EUR',
				convertCurrency: () => -44,
				at,
			})
		).toMatchObject({ value: 0, originalValue: 49 })
	})

	it('refuses a conversion past the amount ceiling', async () => {
		expect(
			await reconcileMoney({
				value: 49,
				currency: 'USD',
				reportingCurrency: 'EUR',
				convertCurrency: () => MAX_EVENT_VALUE * 2,
				at,
			})
		).toMatchObject({ value: 0, originalValue: 49 })
	})
})

describe('dedupeKeyFor', () => {
	const server = { origin: 'server' as const, goal: 'purchase', orderId: 'ord_1' }

	it('keys on the goal and the order', () => {
		expect(dedupeKeyFor(server)).toBe(dedupeKeyFor({ ...server }))
		expect(dedupeKeyFor(server)).not.toBe(dedupeKeyFor({ ...server, orderId: 'ord_2' }))
		expect(dedupeKeyFor(server)).not.toBe(dedupeKeyFor({ ...server, goal: 'signup' }))
	})

	it('gives a refund its own key, so it is not swallowed as a duplicate', () => {
		expect(dedupeKeyFor({ ...server, refund: true })).not.toBe(dedupeKeyFor(server))
	})

	it('keys each refund of an order by its own id, and a retry of one by the same key', () => {
		const refund = { ...server, refund: true, refundId: 're_1' }
		expect(dedupeKeyFor(refund)).toBe(dedupeKeyFor({ ...refund }))
		expect(dedupeKeyFor(refund)).not.toBe(dedupeKeyFor({ ...refund, refundId: 're_2' }))
		expect(dedupeKeyFor(refund)).not.toBe(dedupeKeyFor({ ...server, refund: true }))
	})

	// A sale's key must not move with the change, or a retry straddling it would count twice.
	it('leaves a sale keyed as it always was, refund id or none', () => {
		expect(dedupeKeyFor({ ...server, refundId: 're_1' })).toBe(dedupeKeyFor(server))
		expect(dedupeKeyFor(server)).toBe(
			's.01c4c1f3f454b60aad41ff0c0f9765a756801a60a46efbfe7edf8f1d5ef89069'
		)
	})

	// An order number is guessable: without the key, a stored id would confirm the guess.
	it('keys the digest with the secret, alike on every instance sharing it', () => {
		const key = orderDigestKey('secret')
		const keyed = dedupeKeyFor({ ...server, key })
		expect(keyed).not.toBe(dedupeKeyFor(server))
		expect(keyed).toBe(dedupeKeyFor({ ...server, key: orderDigestKey('secret') }))
		expect(keyed).not.toBe(dedupeKeyFor({ ...server, key: orderDigestKey('another') }))
		expect(dedupeKeyFor({ ...server, origin: 'wire', key }).slice(2)).toBe(keyed.slice(2))
		expect(orderDigestKey('')).toBeUndefined()
		expect(orderDigestKey(undefined)).toBeUndefined()
	})

	it('derives the browser and the server key of one sale from one digest', () => {
		const wire = dedupeKeyFor({ ...server, origin: 'wire' })
		expect(wire.slice(2)).toBe(dedupeKeyFor(server).slice(2))
	})

	it('separates tenants that retry the same order id', () => {
		expect(dedupeKeyFor({ ...server, tenant: 'alpha' })).not.toBe(dedupeKeyFor(server))
		expect(dedupeKeyFor({ ...server, tenant: 'alpha' })).not.toBe(
			dedupeKeyFor({ ...server, tenant: 'beta' })
		)
	})

	// The whole point of the origin: a visitor who guesses an order id must not be able to
	// pre-register it and make the payment webhook's own write look like a duplicate.
	it('never lets a wire key collide with a server key', () => {
		expect(dedupeKeyFor({ ...server, origin: 'wire' })).not.toBe(dedupeKeyFor(server))
		expect(dedupeKeyFor({ ...server, origin: 'wire' }).startsWith('w.')).toBe(true)
		expect(dedupeKeyFor(server).startsWith('s.')).toBe(true)
	})

	// A ':' join would read `goal:"a", orderId:"b:c"` and `goal:"a:b", orderId:"c"` the same,
	// so one order could swallow another's key.
	it('keeps the parts unambiguous', () => {
		expect(dedupeKeyFor({ ...server, goal: 'a', orderId: 'b:c' })).not.toBe(
			dedupeKeyFor({ ...server, goal: 'a:b', orderId: 'c' })
		)
	})

	it('is a fixed-length key whatever the parts are', () => {
		expect(dedupeKeyFor({ ...server, orderId: 'x'.repeat(64) })).toHaveLength(66)
	})
})

describe('isRefund', () => {
	it('is a server revenue call with a negative amount, a refund of nothing included', () => {
		expect(isRefund(true, -49)).toBe(true)
		expect(isRefund(true, -0)).toBe(true)
		expect(isRefund(true, 49)).toBe(false)
		expect(isRefund(true, 0)).toBe(false)
		expect(isRefund(true, undefined)).toBe(false)
		expect(isRefund(true, -MAX_EVENT_VALUE * 2)).toBe(false)
		expect(isRefund(false, -49)).toBe(false)
	})
})

describe('sanitizeOrderId', () => {
	it('keeps an opaque id of any charset', () => {
		expect(sanitizeOrderId('  pi_3Nk✓-α_1 ')).toBe('pi_3Nk✓-α_1')
	})

	it('refuses an id past the cap, rather than truncating two orders into one', () => {
		expect(sanitizeOrderId('x'.repeat(MAX_ORDER_ID_LENGTH))).toHaveLength(MAX_ORDER_ID_LENGTH)
		expect(sanitizeOrderId('x'.repeat(MAX_ORDER_ID_LENGTH + 1))).toBeUndefined()
	})

	it('refuses control characters and empty values', () => {
		expect(sanitizeOrderId(`ord${String.fromCharCode(0)}1`)).toBeUndefined()
		expect(sanitizeOrderId('   ')).toBeUndefined()
		expect(sanitizeOrderId(42)).toBeUndefined()
	})
})

describe('boundedValue', () => {
	it('refuses an amount past the ceiling, and anything that is not a finite number', () => {
		expect(boundedValue(MAX_EVENT_VALUE)).toBe(MAX_EVENT_VALUE)
		expect(boundedValue(-MAX_EVENT_VALUE)).toBe(-MAX_EVENT_VALUE)
		expect(boundedValue(MAX_EVENT_VALUE * 10)).toBeUndefined()
		expect(boundedValue(Number.POSITIVE_INFINITY)).toBeUndefined()
		expect(boundedValue(Number.NaN)).toBeUndefined()
		expect(boundedValue('49')).toBeUndefined()
	})
})
