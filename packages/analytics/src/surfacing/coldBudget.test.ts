import { describe, expect, it } from 'vitest'
import { createColdBudget } from './coldBudget'

const signal = () => new AbortController().signal

describe('createColdBudget', () => {
	it('gives each scope its own places, so one full scope leaves the others free', async () => {
		const budget = createColdBudget(2)
		await budget.take('alpha', signal())
		await budget.take('alpha', signal())
		expect(budget.available('alpha')).toBe(false)
		expect(budget.available('beta')).toBe(true)
		expect(budget.available(null)).toBe(true)
		await budget.take('beta', signal())
	})

	it('keeps the install-wide scope apart from a scope named the empty string', async () => {
		const budget = createColdBudget(1)
		await budget.take(null, signal())
		expect(budget.available('')).toBe(true)
	})

	it('queues a read past the budget in arrival order until a place frees', async () => {
		const budget = createColdBudget(1)
		const release = await budget.take('alpha', signal())
		const order: string[] = []
		const second = budget.take('alpha', signal()).then((done) => {
			order.push('second')
			return done
		})
		const third = budget.take('alpha', signal()).then((done) => {
			order.push('third')
			return done
		})
		await Promise.resolve()
		expect(order).toEqual([])
		release()
		;(await second)()
		;(await third)()
		expect(order).toEqual(['second', 'third'])
		expect(budget.available('alpha')).toBe(true)
	})

	it('drops a waiter whose read gave up, and a release twice frees one place', async () => {
		const budget = createColdBudget(1)
		const release = await budget.take('alpha', signal())
		const controller = new AbortController()
		const reason = new Error('timed out')
		const waiting = budget.take('alpha', controller.signal)
		const refused = expect(waiting).rejects.toBe(reason)
		controller.abort(reason)
		await refused
		release()
		release()
		expect(budget.available('alpha')).toBe(true)
		await budget.take('alpha', signal())
		expect(budget.available('alpha')).toBe(false)
	})
})
