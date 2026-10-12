import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeThrottledPrune, pruneDeliveries } from './prune'

const HOUR_MS = 3_600_000

const makePayload = (deleteMany = vi.fn().mockResolvedValue(undefined)) => {
	const error = vi.fn()
	const payload = { db: { deleteMany }, logger: { error } } as unknown as Payload
	return { deleteMany, error, payload }
}

describe('pruneDeliveries', () => {
	it('deletes only finished rows created before the cutoff', async () => {
		const { deleteMany, payload } = makePayload()
		const now = Date.parse('2026-06-30T00:00:00Z')

		await pruneDeliveries(payload, { olderThanDays: 30, now })

		expect(deleteMany).toHaveBeenCalledWith({
			collection: 'webhook-deliveries',
			where: {
				and: [
					{ createdAt: { less_than: '2026-05-31T00:00:00.000Z' } },
					{ status: { in: ['success', 'dead'] } },
				],
			},
		})
	})

	/** Zero or a negative window would delete every finished row the moment it was written. */
	it('refuses a window that is not a positive number of days', async () => {
		const { deleteMany, payload } = makePayload()
		for (const olderThanDays of [0, -1, Number.NaN, undefined as unknown as number]) {
			await expect(pruneDeliveries(payload, { olderThanDays })).rejects.toThrow(/olderThanDays/)
		}
		expect(deleteMany).not.toHaveBeenCalled()
	})
})

describe('makeThrottledPrune', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-06-30T00:00:00Z'))
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	const prune = () => makeThrottledPrune({ deliveriesSlug: 'log', retentionDays: 7 })

	/** It is called after every dispatched event, so it has to cost nothing most of the time. */
	it('runs at most once an hour, however often it is called', () => {
		const { deleteMany, payload } = makePayload()
		const run = prune()

		run(payload)
		run(payload)
		vi.advanceTimersByTime(HOUR_MS - 1)
		run(payload)
		expect(deleteMany).toHaveBeenCalledTimes(1)

		vi.advanceTimersByTime(1)
		run(payload)
		expect(deleteMany).toHaveBeenCalledTimes(2)
	})

	it('prunes the configured collection with the configured window', () => {
		const { deleteMany, payload } = makePayload()
		prune()(payload)

		expect(deleteMany.mock.calls[0]?.[0]).toMatchObject({
			collection: 'log',
			where: { and: [{ createdAt: { less_than: '2026-06-23T00:00:00.000Z' } }, expect.anything()] },
		})
	})

	/** The caller is a document write. A failed prune is logged and never reaches it. */
	it('logs a failed prune instead of throwing into the write that triggered it', async () => {
		const { error, payload } = makePayload(vi.fn().mockRejectedValue(new Error('db is down')))

		expect(() => prune()(payload)).not.toThrow()
		await vi.runAllTimersAsync()

		expect(error).toHaveBeenCalledWith(expect.stringContaining('db is down'))
	})
})
