import { describe, expect, it } from 'vitest'

import { isMacPlatform, modifierLabels } from './isMacPlatform'

const MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const IPAD =
	'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const WINDOWS =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const LINUX =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

describe('isMacPlatform', () => {
	it('is true on a Mac', () => {
		expect(isMacPlatform(MAC)).toBe(true)
	})

	it('is false everywhere else', () => {
		expect(isMacPlatform(WINDOWS)).toBe(false)
		expect(isMacPlatform(LINUX)).toBe(false)
	})

	it('is false on iOS, which reports a Mac-like agent and has no modifier keys', () => {
		expect(isMacPlatform(IPAD)).toBe(false)
	})

	it('is false when there is no user agent to read, as on the server', () => {
		expect(isMacPlatform(undefined)).toBe(false)
		expect(isMacPlatform('')).toBe(false)
	})
})

describe('modifierLabels', () => {
	it('uses the glyphs printed on Apple keyboards', () => {
		expect(modifierLabels(true)).toEqual({ modifier: '⌘', range: '⇧' })
	})

	it('spells the keys out everywhere else', () => {
		expect(modifierLabels(false)).toEqual({ modifier: 'Ctrl', range: 'Shift' })
	})
})
