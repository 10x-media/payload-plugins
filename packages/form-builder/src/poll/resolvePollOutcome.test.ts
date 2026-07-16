import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolvePollOutcome } from './resolvePollOutcome'

const payloadWith = (poll: unknown) => {
	const findByID = vi.fn().mockResolvedValue({ id: 1, poll })
	const update = vi.fn().mockResolvedValue({})
	return { payload: { findByID, update } as unknown as Payload, findByID, update }
}

describe('resolvePollOutcome', () => {
	it('writes the outcome with overrideAccess and a resolvedAt stamp', async () => {
		const { payload, update } = payloadWith({ enabled: true, resultsField: 'winner' })
		const before = Date.now()
		await resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })
		expect(update).toHaveBeenCalledOnce()
		const args = update.mock.calls[0]?.[0] as {
			collection: string
			id: number
			overrideAccess: boolean
			data: { poll: { outcome: { winningValue: string; resolvedAt: string } } }
		}
		expect(args.collection).toBe('forms')
		expect(args.id).toBe(1)
		expect(args.overrideAccess).toBe(true)
		expect(args.data.poll.outcome.winningValue).toBe('ada')
		const stamped = Date.parse(args.data.poll.outcome.resolvedAt)
		expect(stamped).toBeGreaterThanOrEqual(before)
		expect(stamped).toBeLessThanOrEqual(Date.now())
	})

	it('rejects a form that is not poll-enabled', async () => {
		const { payload, update } = payloadWith({ enabled: false })
		await expect(resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })).rejects.toThrow(
			/not poll-enabled/
		)
		expect(update).not.toHaveBeenCalled()
	})

	it('rejects a form without a poll group', async () => {
		const { payload, update } = payloadWith(null)
		await expect(resolvePollOutcome({ payload, formId: 1, winningValue: 'ada' })).rejects.toThrow(
			/not poll-enabled/
		)
		expect(update).not.toHaveBeenCalled()
	})
})
