import { describe, expect, it } from 'vitest'
import { fileField } from './file'

const fmt = (value: unknown) =>
	fileField.format?.({ value: value as never, config: {}, locale: 'en', t: (k) => k })

describe('file field', () => {
	it('declares the file value kind', () => {
		expect(fileField.value).toBe('file')
		expect(fileField.type).toBe('file')
	})

	it('formats a FileRef as its filename', () => {
		expect(
			fmt({ id: 'u1', filename: 'resume.pdf', mimeType: 'application/pdf', filesize: 10 })
		).toBe('resume.pdf')
	})

	it('formats an empty or non-ref value as an empty string', () => {
		expect(fmt(null)).toBe('')
		expect(fmt(undefined)).toBe('')
		expect(fmt('not-a-ref')).toBe('')
	})

	it('defines no intrinsic validate (presence is the required rule, mime/size is the server capture)', () => {
		expect(fileField.validate).toBeUndefined()
	})
})
