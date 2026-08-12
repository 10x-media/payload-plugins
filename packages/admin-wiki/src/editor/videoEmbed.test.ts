import { describe, expect, it } from 'vitest'

import { parseVideoEmbedUrl } from './videoEmbed'

describe('parseVideoEmbedUrl', () => {
	it('parses youtube watch URLs', () => {
		expect(parseVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
			embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
			provider: 'youtube',
		})
	})

	it('parses youtu.be short links, shorts, embed, and live paths', () => {
		const expected = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
		expect(parseVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')?.embedUrl).toBe(expected)
		expect(parseVideoEmbedUrl('https://youtube.com/shorts/dQw4w9WgXcQ')?.embedUrl).toBe(expected)
		expect(parseVideoEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ?t=1')?.embedUrl).toBe(
			expected
		)
		expect(parseVideoEmbedUrl('https://www.youtube.com/live/dQw4w9WgXcQ')?.embedUrl).toBe(expected)
	})

	it('parses vimeo URLs including unlisted hashes and player links', () => {
		expect(parseVideoEmbedUrl('https://vimeo.com/123456789')).toEqual({
			embedUrl: 'https://player.vimeo.com/video/123456789?dnt=1',
			provider: 'vimeo',
		})
		expect(parseVideoEmbedUrl('https://vimeo.com/123456789/abcdef012345')?.embedUrl).toBe(
			'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef012345'
		)
		expect(parseVideoEmbedUrl('https://player.vimeo.com/video/123456789')?.embedUrl).toBe(
			'https://player.vimeo.com/video/123456789?dnt=1'
		)
	})

	it('rejects unknown hosts, malformed URLs, and bad ids', () => {
		expect(parseVideoEmbedUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull()
		expect(parseVideoEmbedUrl('not a url')).toBeNull()
		expect(parseVideoEmbedUrl('ftp://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
		expect(parseVideoEmbedUrl('https://www.youtube.com/watch')).toBeNull()
		expect(parseVideoEmbedUrl('https://vimeo.com/not-numeric')).toBeNull()
		expect(parseVideoEmbedUrl('https://youtu.be/')).toBeNull()
	})
})
