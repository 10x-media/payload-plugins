import { describe, expect, it } from 'vitest'
import { resolveMessage, withTimeout } from './message'

describe('resolveMessage', () => {
	it('interpolates {vars} from the provided map', () => {
		expect(resolveMessage('Must be at least {min} characters', { min: 3 })).toBe(
			'Must be at least 3 characters'
		)
	})
	it('leaves unknown placeholders untouched', () => {
		expect(resolveMessage('Hi {name}', {})).toBe('Hi {name}')
	})
	it('returns the template unchanged when there are no vars', () => {
		expect(resolveMessage('Required', {})).toBe('Required')
	})
})

describe('withTimeout', () => {
	it('resolves the inner promise when it is fast', async () => {
		await expect(withTimeout(Promise.resolve('ok'), 50, 'fallback')).resolves.toBe('ok')
	})
	it('resolves the fallback when the inner promise is too slow', async () => {
		const slow = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 60))
		await expect(withTimeout(slow, 10, 'fallback')).resolves.toBe('fallback')
	})
})
