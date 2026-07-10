import { describe, expect, it } from 'vitest'
import { buildXmlResponse } from './xmlFactory'

describe('buildXmlResponse XML escaping', () => {
	it('escapes & in play URLs', () => {
		const xml = buildXmlResponse({
			action: {
				type: 'play',
				options: { url: 'https://example.com/audio?flow=1&step=2' },
			},
		})
		expect(xml).not.toContain('&step=')
		expect(xml).toContain('&amp;step=')
	})

	it('escapes & in gather play URLs', () => {
		const xml = buildXmlResponse({
			action: {
				type: 'gather',
				options: {
					onData: 'https://example.com/dtmf?a=1&b=2',
					play: { url: 'https://example.com/prompt?x=1&y=2' },
				},
			},
		})
		expect(xml).toContain('&amp;b=2')
		expect(xml).toContain('&amp;y=2')
	})

	it('escapes & in onAnswer and onHangup attributes', () => {
		const xml = buildXmlResponse({
			onAnswer: 'https://example.com/answer?a=1&b=2',
			onHangup: 'https://example.com/hangup?x=1&y=2',
		})
		expect(xml).toContain('&amp;b=2')
		expect(xml).toContain('&amp;y=2')
		expect(xml).not.toContain('"https://example.com/answer?a=1&b=2"')
	})

	it('escapes < and > in number targets', () => {
		const xml = buildXmlResponse({
			action: {
				type: 'dial',
				options: {
					targets: [{ type: 'number', value: '<script>' }],
				},
			},
		})
		expect(xml).not.toContain('<script>')
		expect(xml).toContain('&lt;script&gt;')
	})

	it('leaves safe content unchanged', () => {
		const xml = buildXmlResponse({
			action: {
				type: 'play',
				options: { url: 'https://example.com/safe' },
			},
		})
		expect(xml).toContain('https://example.com/safe')
	})
})
