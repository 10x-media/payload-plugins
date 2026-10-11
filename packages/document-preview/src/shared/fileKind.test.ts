import { describe, expect, it } from 'vitest'

import { FILE_KINDS, fileKind, isFileKind } from './fileKind'

describe('fileKind', () => {
	it('maps office, PDF, table and archive mimes', () => {
		expect(fileKind('application/pdf', 'a.pdf')).toBe('pdf')
		expect(
			fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')
		).toBe('word')
		expect(fileKind('application/vnd.ms-excel', 'a.xls')).toBe('sheet')
		expect(fileKind('application/vnd.ms-powerpoint', 'a.ppt')).toBe('slides')
		expect(fileKind('text/tab-separated-values', 'a.tsv')).toBe('csv')
		expect(fileKind('application/x-zip-compressed', 'a.zip')).toBe('archive')
	})

	it('maps media by top-level type', () => {
		expect(fileKind('image/heic', 'a.heic')).toBe('image')
		expect(fileKind('audio/flac', 'a.flac')).toBe('audio')
		expect(fileKind('video/quicktime', 'a.mov')).toBe('video')
	})

	it('treats source files as code by extension, whatever the mime', () => {
		expect(fileKind('text/plain', 'index.ts')).toBe('code')
		expect(fileKind('application/xml', 'feed.xml')).toBe('code')
		expect(fileKind('application/json', 'data.json')).toBe('json')
		expect(fileKind('text/markdown', 'README.md')).toBe('markdown')
	})

	it('falls back to text, then to the generic file', () => {
		expect(fileKind('text/plain', 'notes.txt')).toBe('text')
		expect(fileKind('application/octet-stream', 'blob.bin')).toBe('file')
		expect(fileKind('', 'unknown')).toBe('file')
	})
})

describe('isFileKind', () => {
	it('accepts every listed family and nothing else', () => {
		expect(FILE_KINDS.every(isFileKind)).toBe(true)
		expect(isFileKind('exe')).toBe(false)
		expect(isFileKind('../secret')).toBe(false)
	})
})
