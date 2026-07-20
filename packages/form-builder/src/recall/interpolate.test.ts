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
	it('accepts a double-pipe fallback identically to single-pipe', () => {
		expect(interpolate('Hi {{missing||friend}}', resolve)).toBe('Hi friend')
		expect(interpolate('Hi {{empty||friend}}', resolve)).toBe('Hi friend')
	})
	it('uses the present value over the fallback, for both pipe forms', () => {
		expect(interpolate('Hi {{name|friend}}', resolve)).toBe('Hi Ada')
		expect(interpolate('Hi {{name||friend}}', resolve)).toBe('Hi Ada')
	})
	it('treats an empty double-pipe fallback the same as an empty single-pipe fallback', () => {
		expect(interpolate('Hi {{missing|}}!', resolve)).toBe('Hi !')
		expect(interpolate('Hi {{missing||}}!', resolve)).toBe('Hi !')
	})
	it('does not affect the no-pipe wildcard tokens used by serializeBody', () => {
		const withWildcards = (name: string) => ({ '*': 'ALL', '*:table': 'TABLE' })[name] ?? ''
		expect(interpolate('{{*}}', withWildcards)).toBe('ALL')
		expect(interpolate('{{*:table}}', withWildcards)).toBe('TABLE')
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
