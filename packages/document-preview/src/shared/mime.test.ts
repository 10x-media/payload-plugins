import { describe, expect, it } from 'vitest'

import { resolveMimeType } from './mime'

describe('resolveMimeType', () => {
	it('keeps a specific stored mime', () => {
		expect(resolveMimeType('application/pdf', 'report.pdf')).toBe('application/pdf')
	})

	it('drops parameters and lowercases', () => {
		expect(resolveMimeType('Text/Plain; charset=utf-8', 'notes.txt')).toBe('text/plain')
	})

	it('falls back to the extension when the mime is missing or opaque', () => {
		expect(resolveMimeType(undefined, 'deck.PPTX')).toBe(
			'application/vnd.openxmlformats-officedocument.presentationml.presentation'
		)
		expect(resolveMimeType('application/octet-stream', 'data.json')).toBe('application/json')
		expect(resolveMimeType(undefined, 'legacy.xls')).toBe('application/vnd.ms-excel')
	})

	it('lets the extension win for CSV, which Windows reports as an Excel mime', () => {
		expect(resolveMimeType('application/vnd.ms-excel', 'export.csv')).toBe('text/csv')
		expect(resolveMimeType('text/plain', 'export.tsv')).toBe('text/tab-separated-values')
	})

	it('keeps an opaque mime when the extension is unknown', () => {
		expect(resolveMimeType('application/octet-stream', 'archive.bin')).toBe(
			'application/octet-stream'
		)
		expect(resolveMimeType(null, 'no-extension')).toBe('')
	})
})
