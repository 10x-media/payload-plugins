import { describe, expect, it } from 'vitest'
import {
	describeWithCauses,
	HostRefusedError,
	InvalidQueryError,
	invalidQuery,
	isHostRefused,
	isSourceMisconfigured,
	SourceMisconfiguredError,
} from './sourceErrors'

describe('isHostRefused', () => {
	it('finds a host refusal anywhere in the cause chain, and nothing else', () => {
		const refused = new HostRefusedError('https://a.example', 'it is not listed')
		expect(isHostRefused(refused)).toBe(true)
		expect(isHostRefused(new Error('read failed', { cause: refused }))).toBe(true)
		expect(isHostRefused(new SourceMisconfiguredError('bad settings'))).toBe(false)
		expect(isHostRefused(new Error('down'))).toBe(false)
		expect(isHostRefused(undefined)).toBe(false)
	})

	it('is a misconfigured source as well', () => {
		expect(isSourceMisconfigured(new HostRefusedError('https://a.example', 'no'))).toBe(true)
	})

	it('names the host and the reason', () => {
		expect(new HostRefusedError('https://a.example', 'it is not listed').message).toBe(
			'analytics: https://a.example is refused: it is not listed'
		)
	})
})

describe('invalidQuery', () => {
	it('carries a refused read’s message and parameter through a cause chain, and nothing else', () => {
		const refused = new InvalidQueryError('analytics: never both', 'dimensions')
		expect(invalidQuery(refused)).toEqual({ message: 'analytics: never both', param: 'dimensions' })
		expect(invalidQuery(new Error('read failed', { cause: refused }))).toEqual({
			message: 'analytics: never both',
			param: 'dimensions',
		})
		expect(invalidQuery(new Error('down'))).toBeUndefined()
		expect(invalidQuery(undefined)).toBeUndefined()
	})
})

describe('describeWithCauses', () => {
	it('names the error and every cause beneath it', () => {
		const driver = new Error('invalid regular expression: parentheses () not balanced')
		const refused = new InvalidQueryError('analytics: the pattern is refused', 'filters', {
			cause: driver,
		})
		expect(refused.cause).toBe(driver)
		expect(describeWithCauses(refused)).toBe(
			'InvalidQueryError: analytics: the pattern is refused, caused by Error: invalid regular expression: parentheses () not balanced'
		)
		const quoting = new Error(`analytics: read failed (invalid_param): ${refused.message}`, {
			cause: refused,
		})
		expect(describeWithCauses(quoting)).toBe(
			'Error: analytics: read failed (invalid_param): analytics: the pattern is refused, caused by Error: invalid regular expression: parentheses () not balanced'
		)
		expect(describeWithCauses('plain')).toBe('plain')
		expect(describeWithCauses(undefined)).toBe('')
	})
})
