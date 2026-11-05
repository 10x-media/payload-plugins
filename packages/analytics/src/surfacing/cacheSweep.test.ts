import { describe, expect, it, vi } from 'vitest'
import type { Lease } from '../maintenance/lease'
import { memoryCacheStore } from '../testing/memoryCacheStore'
import { createCacheSweeper, SWEEP_BATCH, SWEEP_INTERVAL_MS } from './cacheSweep'

const heldBy = (holder: { owner: string | null }, me: string): Lease => ({
	claim: async () => {
		if (holder.owner !== null && holder.owner !== me) {
			return false
		}
		holder.owner = me
		return true
	},
	release: async () => {
		if (holder.owner === me) {
			holder.owner = null
		}
	},
})

const counting = (deletes: number[]) => {
	const store = memoryCacheStore()
	const sweep = vi.fn(async () => deletes.shift() ?? 0)
	return { store: { ...store, sweep }, sweep }
}

describe('createCacheSweeper', () => {
	it('sweeps one batch of 1,000 by default, without a lease when none is offered', async () => {
		const { store, sweep } = counting([3])
		const sweeper = createCacheSweeper({ store, lease: () => undefined, now: () => new Date(0) })
		expect(await sweeper.sweep()).toEqual({ ran: true, swept: 3 })
		expect(sweep).toHaveBeenCalledWith(new Date(0), SWEEP_BATCH)
	})

	it('leaves a sweep for later while it is deferred, before it so much as claims its lease', async () => {
		const { store, sweep } = counting([3])
		const claim = vi.fn(async () => true)
		let deferred = true
		const sweeper = createCacheSweeper({
			store,
			lease: () => ({ claim, release: async () => undefined }),
			now: () => new Date(0),
			deferred: () => deferred,
		})
		expect(await sweeper.sweep()).toEqual({ ran: false, swept: 0 })
		expect(claim).not.toHaveBeenCalled()
		expect(sweep).not.toHaveBeenCalled()
		deferred = false
		expect(await sweeper.sweep()).toEqual({ ran: true, swept: 3 })
	})

	it('goes on batch after batch while each comes back full, up to the limit', async () => {
		const { store, sweep } = counting([2, 2, 1, 2])
		const sweeper = createCacheSweeper({
			store,
			lease: () => undefined,
			now: () => new Date(0),
			batch: 2,
		})
		expect(await sweeper.sweep(10)).toEqual({ ran: true, swept: 5 })
		expect(sweep).toHaveBeenCalledTimes(3)
		const capped = counting([2, 2, 2, 2])
		const limited = createCacheSweeper({
			store: capped.store,
			lease: () => undefined,
			now: () => new Date(0),
			batch: 2,
		})
		expect(await limited.sweep(2)).toEqual({ ran: true, swept: 4 })
	})

	it('deletes nothing while another holder has the lease, and gives its own back', async () => {
		const holder = { owner: 'other' as string | null }
		const { store, sweep } = counting([1, 1])
		const sweeper = createCacheSweeper({
			store,
			lease: () => heldBy(holder, 'me'),
			now: () => new Date(0),
		})
		expect(await sweeper.sweep()).toEqual({ ran: false, swept: 0 })
		expect(sweep).not.toHaveBeenCalled()
		holder.owner = null
		expect(await sweeper.sweep()).toEqual({ ran: true, swept: 1 })
		expect(holder.owner).toBeNull()
	})

	it('gives the lease back when the sweep fails', async () => {
		const holder = { owner: null as string | null }
		const store = { ...memoryCacheStore(), sweep: async () => Promise.reject(new Error('busy')) }
		const sweeper = createCacheSweeper({
			store,
			lease: () => heldBy(holder, 'me'),
			now: () => new Date(0),
		})
		await expect(sweeper.sweep()).rejects.toThrow('busy')
		expect(holder.owner).toBeNull()
	})

	it('starts a background sweep at most once per interval, and reports a failure', async () => {
		let at = 0
		const warn = vi.fn()
		const sweep = vi.fn(async () => {
			if (at > SWEEP_INTERVAL_MS) {
				throw new Error('locked')
			}
			return 0
		})
		const sweeper = createCacheSweeper({
			store: { ...memoryCacheStore(), sweep },
			lease: () => undefined,
			now: () => new Date(at),
			warn,
		})
		sweeper.maybeSweep()
		sweeper.maybeSweep()
		await sweeper.idle()
		at = SWEEP_INTERVAL_MS - 1
		sweeper.maybeSweep()
		await sweeper.idle()
		expect(sweep).toHaveBeenCalledTimes(1)
		at = SWEEP_INTERVAL_MS + 1
		sweeper.maybeSweep()
		await sweeper.idle()
		expect(sweep).toHaveBeenCalledTimes(2)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('locked'))
	})
})
