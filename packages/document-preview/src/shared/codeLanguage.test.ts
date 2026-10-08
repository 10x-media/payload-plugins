import { describe, expect, it } from 'vitest'

import { codeLanguage } from './codeLanguage'

describe('codeLanguage', () => {
	it('prefers the extension', () => {
		expect(codeLanguage('config.YML', 'text/plain')).toBe('yaml')
		expect(codeLanguage('query.sql', 'application/octet-stream')).toBe('sql')
		expect(codeLanguage('index.tsx', 'text/plain')).toBe('typescript')
	})

	it('falls back to the mime, then to plain text', () => {
		expect(codeLanguage('payload', 'application/json')).toBe('json')
		expect(codeLanguage('notes.txt', 'text/plain')).toBe('plaintext')
		expect(codeLanguage('server.log', 'text/plain')).toBe('plaintext')
	})
})
