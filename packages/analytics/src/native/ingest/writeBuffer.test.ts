import { describe, expect, it } from 'vitest'
import { createWriteBuffer } from './writeBuffer'

const noTimer = () => () => {}

describe('createWriteBuffer', () => {
	it('flushes when maxSize is reached', async () => {
		const flushed: number[][] = []
		const buf = createWriteBuffer<number>({
			maxSize: 3,
			maxAgeMs: 1000,
			onFlush: async (items) => {
				flushed.push(items)
			},
			setTimer: noTimer,
		})
		buf.add(1)
		buf.add(2)
		expect(flushed).toHaveLength(0)
		buf.add(3)
		await buf.flush()
		expect(flushed).toEqual([[1, 2, 3]])
		expect(buf.size()).toBe(0)
	})

	it('flushes on the timer when below maxSize', async () => {
		const fires: Array<() => void> = []
		const flushed: number[][] = []
		const buf = createWriteBuffer<number>({
			maxSize: 10,
			maxAgeMs: 1000,
			onFlush: async (items) => {
				flushed.push(items)
			},
			setTimer: (fn) => {
				fires.push(fn)
				return () => {}
			},
		})
		buf.add(1)
		buf.add(2)
		expect(fires).toHaveLength(1)
		fires[0]?.()
		await buf.flush()
		expect(flushed).toEqual([[1, 2]])
	})

	it('reports flush errors via onError and does not throw', async () => {
		const errors: unknown[] = []
		const buf = createWriteBuffer<number>({
			maxSize: 1,
			maxAgeMs: 1000,
			onFlush: async () => {
				throw new Error('boom')
			},
			onError: (error) => {
				errors.push(error)
			},
			setTimer: noTimer,
		})
		buf.add(1)
		await buf.flush()
		expect(errors).toHaveLength(1)
	})

	it('stop() drains remaining items', async () => {
		const flushed: number[][] = []
		const buf = createWriteBuffer<number>({
			maxSize: 10,
			maxAgeMs: 1000,
			onFlush: async (items) => {
				flushed.push(items)
			},
			setTimer: noTimer,
		})
		buf.add(1)
		await buf.stop()
		expect(flushed).toEqual([[1]])
	})
})
