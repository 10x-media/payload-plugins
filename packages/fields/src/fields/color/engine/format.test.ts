import { describe, expect, it } from 'vitest'
import { convertColor, formatColor } from './format'
import { parseColor } from './parse'
import type { ColorFormat, ParsedColor } from './types'

const parse = (input: string): ParsedColor => {
	const parsed = parseColor(input)
	if (!parsed) throw new Error(`expected ${input} to parse`)
	return parsed
}

describe('formatColor', () => {
	it('emits hex, 8 digits only when alpha < 1', () => {
		expect(formatColor(parse('red'), 'hex')).toBe('#ff0000')
		expect(formatColor(parse('rgb(255 0 0 / 0.5)'), 'hex')).toBe('#ff000080')
		expect(formatColor(parse('#ff000080'), 'hex')).toBe('#ff000080')
		expect(formatColor(parse('hsl(120 100% 25%)'), 'hex')).toBe('#008000')
		expect(formatColor(parse('transparent'), 'hex')).toBe('#00000000')
	})

	it('strips alpha when the alpha option is false', () => {
		expect(formatColor(parse('#ff000080'), 'hex', { alpha: false })).toBe('#ff0000')
		expect(formatColor(parse('rgba(255,0,0,0.5)'), 'rgb', { alpha: false })).toBe('rgb(255 0 0)')
	})

	it('emits modern rgb and hsl syntax', () => {
		expect(formatColor(parse('#ff0000'), 'rgb')).toBe('rgb(255 0 0)')
		expect(formatColor(parse('rgba(255, 0, 0, 0.5)'), 'rgb')).toBe('rgb(255 0 0 / 0.5)')
		expect(formatColor(parse('#ff0000'), 'hsl')).toBe('hsl(0 100% 50%)')
		expect(formatColor(parse('rgb(255 0 0 / 0.25)'), 'hsl')).toBe('hsl(0 100% 50% / 0.25)')
	})

	it('emits oklch and preserves a parsed oklch representation exactly', () => {
		expect(formatColor(parse('oklch(0.62 0.25 29)'), 'oklch')).toBe('oklch(0.62 0.25 29)')
		expect(formatColor(parse('oklch(0.62 0.25 29 / 0.5)'), 'oklch')).toBe(
			'oklch(0.62 0.25 29 / 0.5)'
		)
		expect(formatColor(parse('#ff0000'), 'oklch')).toBe('oklch(0.628 0.2577 29.23)')
	})

	it('is idempotent per stored format', () => {
		const cases: Array<[string, ColorFormat]> = [
			['#ff000080', 'hex'],
			['rgb(14 165 233)', 'rgb'],
			['hsl(210 40% 30%)', 'hsl'],
			['oklch(0.62 0.25 29)', 'oklch'],
			['oklch(0.5 0.1 359.996)', 'oklch'],
			['hsl(359.98 50% 50%)', 'hsl'],
			['rgb(255 0 0 / 0.502)', 'rgb'],
		]
		for (const [input, format] of cases) {
			const once = formatColor(parse(input), format)
			expect(formatColor(parse(once), format), input).toBe(once)
		}
	})

	it('never emits a hue of 360, wrapping to 0 instead', () => {
		expect(formatColor(parse('oklch(0.5 0.1 359.996)'), 'oklch')).toBe('oklch(0.5 0.1 0)')
	})

	it('clamps crafted alpha values instead of leaking them into output', () => {
		const red = parse('#ff0000')
		expect(formatColor({ ...red, alpha: -0.5 }, 'rgb')).toBe('rgb(255 0 0 / 0)')
		expect(formatColor({ ...red, alpha: Number.NaN }, 'hex')).toBe('#ff0000')
		expect(formatColor({ ...red, alpha: Number.POSITIVE_INFINITY }, 'rgb')).toBe('rgb(255 0 0)')
	})

	it('gamut-maps out-of-gamut oklch when emitting srgb formats', () => {
		const hex = formatColor(parse('oklch(0.7 0.35 150)'), 'hex')
		expect(hex).toMatch(/^#[0-9a-f]{6}$/)
	})

	it('convertColor parses and formats, returning null on garbage', () => {
		expect(convertColor('tomato', 'rgb')).toBe('rgb(255 99 71)')
		expect(convertColor('red', 'hex')).toBe('#ff0000')
		expect(convertColor('garbage', 'rgb')).toBeNull()
	})
})
