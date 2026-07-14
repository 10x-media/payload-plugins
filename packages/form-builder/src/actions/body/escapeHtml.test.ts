import { describe, expect, it } from 'vitest'
import { escapeHtml } from './escapeHtml'

describe('escapeHtml', () => {
	it('escapes the five HTML-significant characters', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
	})

	it('returns plain text unchanged', () => {
		expect(escapeHtml('Hello world 123')).toBe('Hello world 123')
	})

	it('escapes every occurrence', () => {
		expect(escapeHtml('<b>&</b>')).toBe('&lt;b&gt;&amp;&lt;/b&gt;')
	})

	it('handles the empty string', () => {
		expect(escapeHtml('')).toBe('')
	})
})
