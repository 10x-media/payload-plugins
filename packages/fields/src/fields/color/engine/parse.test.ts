import { describe, expect, it } from 'vitest'
import { namedColors } from './namedColors'
import { parseColor } from './parse'

// biome-ignore lint/complexity/useMaxParams: rgb channel triple plus alpha mirrors the color model
const rgb = (r: number, g: number, b: number, alpha = 1) => ({ mode: 'rgb', r, g, b, alpha })

describe('parseColor', () => {
	it('parses 3/4/6/8 digit hex', () => {
		expect(parseColor('#f00')).toEqual(rgb(1, 0, 0))
		expect(parseColor('#f008')).toMatchObject({ alpha: 136 / 255 })
		expect(parseColor('#FF0000')).toEqual(rgb(1, 0, 0))
		expect(parseColor('#ff000080')).toMatchObject({ alpha: 128 / 255 })
	})

	it('parses legacy and modern rgb syntax', () => {
		expect(parseColor('rgb(255, 0, 0)')).toEqual(rgb(1, 0, 0))
		expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual(rgb(1, 0, 0, 0.5))
		expect(parseColor('rgb(255 0 0)')).toEqual(rgb(1, 0, 0))
		expect(parseColor('rgb(255 0 0 / 0.5)')).toEqual(rgb(1, 0, 0, 0.5))
		expect(parseColor('rgb(100% 0% 0% / 50%)')).toEqual(rgb(1, 0, 0, 0.5))
	})

	it('parses hsl', () => {
		expect(parseColor('hsl(0 100% 50%)')).toEqual(rgb(1, 0, 0))
		const green = parseColor('hsl(120 100% 25%)')
		expect(green).toMatchObject({ mode: 'rgb', r: 0, b: 0 })
		expect((green as { g: number }).g).toBeCloseTo(0.5, 5)
		expect(parseColor('hsla(0, 100%, 50%, 0.25)')).toEqual(rgb(1, 0, 0, 0.25))
		expect(parseColor('hsl(0deg 100% 50%)')).toEqual(rgb(1, 0, 0))
	})

	it('parses oklch, keeping the oklch representation', () => {
		expect(parseColor('oklch(0.62 0.25 29)')).toEqual({
			mode: 'oklch',
			l: 0.62,
			c: 0.25,
			h: 29,
			alpha: 1,
		})
		expect(parseColor('oklch(62% 0.25 29 / 50%)')).toMatchObject({ l: 0.62, alpha: 0.5 })
		// C percentage is relative to 0.4 per CSS Color 4
		expect(parseColor('oklch(0.62 50% 29)')).toMatchObject({ c: 0.2 })
	})

	it('parses the full named color table and transparent', () => {
		expect(Object.keys(namedColors)).toHaveLength(148)
		expect(parseColor('rebeccapurple')).toEqual(parseColor('#663399'))
		expect(parseColor('RebeccaPurple')).toEqual(parseColor('#663399'))
		expect(parseColor('tomato')).toEqual(parseColor('#ff6347'))
		expect(parseColor('transparent')).toEqual(rgb(0, 0, 0, 0))
	})

	it('rejects garbage', () => {
		const bad = [
			'',
			'   ',
			'nope',
			'#ff',
			'#ggg',
			'rgb(255 0)',
			'rgb(1,2,3,4,5)',
			'rgb(25x 0 0)',
			'hsl(0 1 2 3 4)',
			'oklch()',
			'color(display-p3 1 0 0)',
		]
		for (const input of bad) {
			expect(parseColor(input), JSON.stringify(input)).toBeNull()
		}
	})
})
