import { describe, expect, it, vi } from 'vitest'

import { withIdempotencyKey } from './concurrencyContract'

describe('withIdempotencyKey', () => {
	it('runs the handler once per key and skips the second time', async () => {
		const store = new Map<string, true>()
		const idemStore = {
			has: (k: string) => Promise.resolve(store.has(k)),
			mark: (k: string) => {
				store.set(k, true)
				return Promise.resolve()
			},
		}
		const effect = vi.fn((_args: { job: { id: number } }) =>
			Promise.resolve({ output: { ran: true } })
		)
		const wrapped = withIdempotencyKey(effect, { keyFor: () => 'k1', store: idemStore })

		const first = await wrapped({ job: { id: 1 } })
		const second = await wrapped({ job: { id: 1 } })

		expect(effect).toHaveBeenCalledTimes(1)
		expect(first).toEqual({ output: { ran: true } })
		expect(second).toEqual({ output: {} })
	})
})
