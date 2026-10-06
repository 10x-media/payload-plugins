import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { dailySalt, saltKey } from './salt'

const DAY_MS = 86_400_000
const NOW = new Date('2031-05-10T11:00:00.000Z')

interface FakeKv {
	payload: Payload
	store: Map<string, { salt: string }>
	deleted: string[]
}

const fakeKv = (onDelete?: (key: string) => Promise<void>): FakeKv => {
	const store = new Map<string, { salt: string }>()
	const deleted: string[] = []
	const kv = {
		get: (key: string) => Promise.resolve(store.get(key)),
		set: (key: string, value: { salt: string }) => {
			store.set(key, value)
			return Promise.resolve()
		},
		delete: (key: string) => {
			deleted.push(key)
			store.delete(key)
			return onDelete ? onDelete(key) : Promise.resolve()
		},
	}
	return { payload: { kv } as unknown as Payload, store, deleted }
}

const dayKey = (daysAgo: number): string => saltKey(new Date(NOW.getTime() - daysAgo * DAY_MS))

describe('dailySalt', () => {
	it('reuses the day it already has, and sweeps nothing for it', async () => {
		const { payload, store, deleted } = fakeKv()
		store.set(dayKey(0), { salt: 'kept' })
		expect(await dailySalt(payload, NOW)).toBe('kept')
		expect(deleted).toEqual([])
	})

	it('sweeps the week before the day it creates, keeping yesterday', async () => {
		const { payload, deleted } = fakeKv()
		const salt = await dailySalt(payload, NOW)
		expect(salt).toMatch(/^[0-9a-f]{32}$/)
		expect(deleted).not.toContain(dayKey(0))
		expect(deleted).not.toContain(dayKey(1))
		expect(deleted).toContain(dayKey(2))
		expect(deleted).toContain(dayKey(8))
		expect(deleted).not.toContain(dayKey(9))
		expect(deleted).toHaveLength(7)
	})

	it('answers with the salt even when the sweep fails', async () => {
		const { payload } = fakeKv(() => Promise.reject(new Error('kv down')))
		await expect(dailySalt(payload, NOW)).resolves.toMatch(/^[0-9a-f]{32}$/)
	})

	it('answers with the salt even when the kv adapter throws synchronously', async () => {
		const kv = {
			get: () => Promise.resolve(undefined),
			set: () => Promise.resolve(),
			delete: (): Promise<void> => {
				throw new Error('kv down')
			},
		}
		const payload = { kv } as unknown as Payload
		await expect(dailySalt(payload, NOW)).resolves.toMatch(/^[0-9a-f]{32}$/)
	})
})
