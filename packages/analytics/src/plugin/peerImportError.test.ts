import { describe, expect, it } from 'vitest'
import { isModuleNotFoundError } from './peerImportError'

describe('isModuleNotFoundError', () => {
	it('is true for an ESM module-resolution failure', () => {
		const err = Object.assign(new Error('Cannot find module'), { code: 'ERR_MODULE_NOT_FOUND' })
		expect(isModuleNotFoundError(err)).toBe(true)
	})

	it('is true for a CJS module-resolution failure', () => {
		const err = Object.assign(new Error('Cannot find module'), { code: 'MODULE_NOT_FOUND' })
		expect(isModuleNotFoundError(err)).toBe(true)
	})

	it('is false for any other error, including one carrying an unrelated code', () => {
		expect(isModuleNotFoundError(new Error('boom'))).toBe(false)
		expect(isModuleNotFoundError(Object.assign(new Error('boom'), { code: 'EACCES' }))).toBe(false)
	})

	it('is false for a non-Error throw', () => {
		expect(isModuleNotFoundError('boom')).toBe(false)
		expect(isModuleNotFoundError(undefined)).toBe(false)
	})
})
