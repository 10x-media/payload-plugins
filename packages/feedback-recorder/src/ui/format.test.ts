import { describe, expect, it } from 'vitest'

import { copyFileName, formatDuration } from './format'

describe('formatDuration', () => {
	it('formats minutes and seconds', () => {
		expect(formatDuration(0)).toBe('0:00')
		expect(formatDuration(75)).toBe('1:15')
		expect(formatDuration(3725)).toBe('1:02:05')
		expect(formatDuration(-4)).toBe('0:00')
	})
})

describe('copyFileName', () => {
	it('names the copy after the time and the container', () => {
		const now = new Date('2026-10-13T14:05:09Z')
		expect(copyFileName(new Blob([], { type: 'video/mp4' }), now)).toBe(
			'recording-2026-10-13-1405.mp4'
		)
		expect(copyFileName(new Blob([], { type: 'video/webm;codecs=vp9' }), now)).toBe(
			'recording-2026-10-13-1405.webm'
		)
	})
})
