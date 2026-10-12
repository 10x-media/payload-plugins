import type { Payload } from 'payload'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEventInput } from '../core/serverEvent'
import { trackServerEvent } from '../native/ingest/serverTrack'
import { ORDERS_PATH, purchase, refund } from './serverRevenue'

vi.mock('../native/ingest/serverTrack', () => ({ trackServerEvent: vi.fn(async () => {}) }))

const payload = { config: { serverURL: 'https://shop.example.com' } } as Payload

const recorded = (): ServerEventInput =>
	vi.mocked(trackServerEvent).mock.calls[0]?.[1] as ServerEventInput

describe('purchase and refund', () => {
	beforeEach(() => {
		vi.mocked(trackServerEvent).mockClear()
	})

	it('records a sale as a revenue goal event against the built-in purchase goal', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49, currency: 'EUR' })
		expect(recorded()).toMatchObject({
			type: 'goal',
			name: 'purchase',
			value: 49,
			currency: 'EUR',
			revenue: true,
			orderId: 'ord_1',
			hostname: 'shop.example.com',
			path: '/orders',
		})
	})

	// A path is a value of the daily totals, which outlive the raw hits and any erasure of them.
	it('files every order under one path, never its id', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49 })
		await refund(payload, { orderId: 'ord_1', refundId: 're_1', value: 49 })
		const paths = vi.mocked(trackServerEvent).mock.calls.map((call) => call[1].path)
		expect(paths).toEqual([ORDERS_PATH, ORDERS_PATH])
		expect(paths.join()).not.toContain('ord_1')
	})

	it('files the sale under the page the call names', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49, path: '/checkout' })
		expect(recorded().path).toBe('/checkout')
	})

	it('books a sale against the goal it names', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49, goal: 'upgrade' })
		expect(recorded().name).toBe('upgrade')
	})

	// The sign belongs to the call: a payment provider that reports refunds as positives and one
	// that reports them as negatives both mean the same thing.
	it('records a refund as a negative amount whichever sign the caller passed', async () => {
		await refund(payload, { orderId: 'ord_1', refundId: 're_1', value: 49 })
		expect(recorded().value).toBe(-49)
		vi.mocked(trackServerEvent).mockClear()
		await refund(payload, { orderId: 'ord_1', refundId: 're_1', value: -49 })
		expect(recorded().value).toBe(-49)
	})

	it('hands the refund its own id, which keys it beside the order', async () => {
		await refund(payload, { orderId: 'ord_1', refundId: 're_2', value: 10 })
		expect(recorded()).toMatchObject({ orderId: 'ord_1', refundId: 're_2', revenue: true })
	})

	it('sends a sale no refund id', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49 })
		expect('refundId' in recorded()).toBe(false)
	})

	it('carries the lines of the sale through to ingest', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49, items: [{ id: 'sku-1' }] })
		expect(recorded().items).toEqual([{ id: 'sku-1' }])
	})

	it('credits the sale to the content item it names', async () => {
		await purchase(payload, { orderId: 'ord_1', value: 49, item: 'offers:7' })
		expect(recorded().item).toBe('offers:7')
	})
})
