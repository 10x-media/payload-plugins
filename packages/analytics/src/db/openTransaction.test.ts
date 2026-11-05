import { describe, expect, it } from 'vitest'
import { afterTransaction } from './openTransaction'

describe('afterTransaction', () => {
	it('runs the work once the transaction ends, and not before', async () => {
		let open = true
		const ran: string[] = []
		const done = afterTransaction(
			() => open,
			async () => {
				ran.push('work')
				return 'done'
			},
			{ pollMs: 5 }
		)
		await new Promise((resolve) => setTimeout(resolve, 30))
		expect(ran).toEqual([])
		open = false
		await expect(done).resolves.toBe('done')
		expect(ran).toEqual(['work'])
	})

	it('runs the work anyway once it waited as long as it may', async () => {
		await expect(
			afterTransaction(
				() => true,
				async () => 'ran',
				{ pollMs: 5, waitMs: 20 }
			)
		).resolves.toBe('ran')
	})
})
