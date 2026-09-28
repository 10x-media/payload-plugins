import { describe, expect, it } from 'vitest'

import { acceptsType, attachmentsOf, formatSize } from './shared'

describe('acceptsType', () => {
	it('takes anything without a list, and matches exact types and wildcards', () => {
		expect(acceptsType([], 'application/zip')).toBe(true)
		expect(acceptsType(['image/*', 'application/pdf'], 'image/png')).toBe(true)
		expect(acceptsType(['image/*', 'application/pdf'], 'application/pdf')).toBe(true)
		expect(acceptsType(['image/*', 'application/pdf'], 'text/plain')).toBe(false)
	})
})

describe('formatSize', () => {
	it('picks a unit and keeps one decimal below ten', () => {
		expect(formatSize(null)).toBe('')
		expect(formatSize(512)).toBe('512 B')
		expect(formatSize(1536)).toBe('1.5 KB')
		expect(formatSize(20 * 1024 * 1024)).toBe('20 MB')
	})
})

describe('attachmentsOf', () => {
	it('reads the decorated list, or nothing', () => {
		expect(attachmentsOf({})).toEqual([])
		expect(attachmentsOf({ ext: { attachments: 'broken' } })).toEqual([])
		expect(attachmentsOf({ ext: { attachments: [{ id: 1 }] } })).toEqual([{ id: 1 }])
	})
})
