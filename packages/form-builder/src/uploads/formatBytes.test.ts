import { describe, expect, it } from 'vitest'
import { formatBytes } from './formatBytes'

describe('formatBytes', () => {
	it('formats zero and sub-KB counts as bytes', () => {
		expect(formatBytes(0)).toBe('0 B')
		expect(formatBytes(500)).toBe('500 B')
		expect(formatBytes(999)).toBe('999 B')
		expect(formatBytes(1023)).toBe('1023 B')
	})

	it('formats KB at the 1024 boundary without a trailing .0', () => {
		expect(formatBytes(1024)).toBe('1 KB')
		expect(formatBytes(1536)).toBe('1.5 KB')
	})

	it('formats MB with at most one decimal', () => {
		expect(formatBytes(2621440)).toBe('2.5 MB')
		expect(formatBytes(1048576)).toBe('1 MB')
		expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
	})

	it('formats GB and caps at the largest unit', () => {
		expect(formatBytes(1024 ** 3)).toBe('1 GB')
		expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
		expect(formatBytes(2048 * 1024 ** 3)).toBe('2048 GB')
	})

	it('treats negative and non-finite input as zero', () => {
		expect(formatBytes(-1)).toBe('0 B')
		expect(formatBytes(Number.NaN)).toBe('0 B')
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
	})
})
