import type { NumberField, SelectField } from 'payload'
import { describe, expect, it } from 'vitest'
import { buildFileField, fileField, fileMimeTypeOptions } from './file'

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
		expect(mimeTypes.options).toEqual(fileMimeTypeOptions)
		const values = fileMimeTypeOptions.map((option) => option.value)
		expect(values).toContain('image/*')
		expect(values).toContain('application/pdf')
		expect(new Set(values).size).toBe(values.length)
	})

	const mimeOptionValues = (definition: ReturnType<typeof buildFileField>) => {
		const field = definition.config?.find(
			(entry) => 'name' in entry && entry.name === 'mimeTypes'
		) as SelectField
		return (field.options as { value: string }[]).map((option) => option.value)
	}

	it('constrains the mimeTypes picker to the host collection mimeTypes, dropping svg/av/wildcards', () => {
		const values = mimeOptionValues(buildFileField(['image/png', 'image/jpeg', 'application/pdf']))
		expect(values).toContain('image/png')
		expect(values).toContain('application/pdf')
		expect(values).not.toContain('image/svg+xml')
		expect(values).not.toContain('image/*')
		expect(values).not.toContain('audio/*')
	})

	it('keeps the full option list when the host declares no mimeTypes', () => {
		expect(mimeOptionValues(buildFileField())).toEqual(fileMimeTypeOptions.map((o) => o.value))
	})

	it('keeps every mimeTypes option value within the 63-byte postgres enum label limit', () => {
		for (const option of fileMimeTypeOptions) {
			expect(Buffer.byteLength(option.value, 'utf8')).toBeLessThanOrEqual(63)
		}
	})

	it('mounts ByteSizeField on maxSize with the size-limit description as a translation key', () => {
		const maxSize = fileField.config?.find(
			(entry) => 'name' in entry && entry.name === 'maxSize'
		) as NumberField
		expect(maxSize.type).toBe('number')
		const component = maxSize.admin?.components?.Field as
			| { path?: string; clientProps?: { descriptionKey?: string } }
			| undefined
		expect(component?.path).toBe('@10x-media/form-builder/client#ByteSizeField')
		// A custom Field component replaces Payload's whole default render, including the
		// description slot, so admin.description would be silently inert here.
		expect(component?.clientProps?.descriptionKey).toBe(
			'formBuilder:file.config.maxSizeDescription'
		)
		expect(maxSize.admin?.description).toBeUndefined()
	})
})
