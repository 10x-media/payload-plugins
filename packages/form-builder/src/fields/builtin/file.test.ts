import type { NumberField, SelectField } from 'payload'
import { describe, expect, it } from 'vitest'
import { fileField, fileMimeTypeOptions } from './file'

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

	it('configures mimeTypes as a curated hasMany select with raw MIME values', () => {
		const mimeTypes = fileField.config?.find(
			(entry) => 'name' in entry && entry.name === 'mimeTypes'
		) as SelectField
		expect(mimeTypes.type).toBe('select')
		expect(mimeTypes.hasMany).toBe(true)
		expect(mimeTypes.options).toBe(fileMimeTypeOptions)
		const values = fileMimeTypeOptions.map((option) => option.value)
		expect(values).toContain('image/*')
		expect(values).toContain('application/pdf')
		expect(new Set(values).size).toBe(values.length)
	})

	it('mounts the ByteSizeField component on maxSize', () => {
		const maxSize = fileField.config?.find(
			(entry) => 'name' in entry && entry.name === 'maxSize'
		) as NumberField
		expect(maxSize.type).toBe('number')
		expect(maxSize.admin?.components?.Field).toBe('@10x-media/form-builder/client#ByteSizeField')
		expect(maxSize.admin?.description).toBeDefined()
	})
})
