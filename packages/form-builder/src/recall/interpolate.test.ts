import { describe, expect, it } from 'vitest'
import { interpolate } from './interpolate'

describe('interpolate', () => {
	const resolve = (name: string) => ({ name: 'Ada', empty: '' })[name] ?? ''

	it('returns token-free text unchanged', () => {
		expect(interpolate('Hello there', resolve)).toBe('Hello there')
	})
	it('replaces a token with the resolved value (whitespace-tolerant)', () => {
		expect(interpolate('Hi {{ name }}!', resolve)).toBe('Hi Ada!')
	})
	it('uses the fallback when the value is empty', () => {
		expect(interpolate('Hi {{missing|friend}}', resolve)).toBe('Hi friend')
		expect(interpolate('Hi {{empty|friend}}', resolve)).toBe('Hi friend')
	})
	it('drops a missing token with no fallback', () => {
		expect(interpolate('Hi {{missing}}!', resolve)).toBe('Hi !')
	})
	it('replaces multiple tokens', () => {
		expect(interpolate('{{name}} {{name}}', resolve)).toBe('Ada Ada')
	})
	it('does not re-interpolate a resolved value that itself contains a token', () => {
		const recall = (name: string) => (name === 'name' ? '{{evil}}' : name === 'evil' ? 'PWNED' : '')
		expect(interpolate('{{name}}', recall)).toBe('{{evil}}')
	})
	it('leaves an unterminated or empty token literal', () => {
		expect(interpolate('{{a', resolve)).toBe('{{a')
		expect(interpolate('{{}}', resolve)).toBe('{{}}')
	})
})
