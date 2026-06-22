import type { Payload, Where } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolveReliabilityOptions } from './options'
import { runSweep } from './sweeper'

const baseOptions = () => {
	const r = resolveReliabilityOptions({})
	if (!r) throw new Error('null options')
	return r
}

const makeFakePayload = (docs: Array<{ id: string | number; recoveryAttempts?: number }>) => {
	const findSpy = vi.fn().mockResolvedValue({ docs })
	return {
		payload: { find: findSpy } as unknown as Payload,
		findSpy,
	}
}

const makeStore = () => ({
	deadLetter: vi.fn().mockResolvedValue({ ok: true }),
	read: vi.fn().mockResolvedValue(null),
	requeue: vi.fn().mockResolvedValue({ ok: true }),
	releaseAllClaims: vi.fn().mockResolvedValue({ released: 0 }),
	renew: vi.fn().mockResolvedValue({ ok: true }),
	stampClaim: vi.fn().mockResolvedValue({ ok: true, fenceToken: 1 }),
})

describe('runSweep', () => {
	it('passes sort: updatedAt to the find call', async () => {
		const { payload, findSpy } = makeFakePayload([])
		await runSweep({
			isLeader: true,
			now: new Date(),
			options: baseOptions(),
			payload,
			store: makeStore(),
		})
		expect(findSpy).toHaveBeenCalledTimes(1)
		const callArgs = findSpy.mock.calls[0][0] as { sort?: string; where?: Where }
		expect(callArgs.sort).toBe('updatedAt')
	})

	it('is a no-op when not leader', async () => {
		const { payload, findSpy } = makeFakePayload([])
		const result = await runSweep({
			isLeader: false,
			now: new Date(),
			options: baseOptions(),
			payload,
			store: makeStore(),
		})
		expect(findSpy).not.toHaveBeenCalled()
		expect(result).toEqual({ deadLettered: 0, requeued: 0, scanned: 0 })
	})
})
