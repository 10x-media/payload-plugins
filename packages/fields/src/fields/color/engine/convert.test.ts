import { describe, expect, it } from 'vitest'
import {
	hsvToRgb,
	isInSrgbGamut,
	oklchToRgb,
	oklchToRgbUnmapped,
	rgbToHsv,
	rgbToOklch,
	srgbToLinear,
} from './convert'
import { parseColor } from './parse'
import type { OklchColor, RgbColor } from './types'

const red: RgbColor = { mode: 'rgb', r: 1, g: 0, b: 0, alpha: 1 }
const asRgb = (input: string): RgbColor => {
	const parsed = parseColor(input)
	if (parsed?.mode !== 'rgb') throw new Error(`expected rgb parse for ${input}`)
	return parsed
}

describe('srgb transfer function', () => {
	it('linearizes reference points', () => {
		expect(srgbToLinear(0)).toBe(0)
		expect(srgbToLinear(1)).toBe(1)
		expect(srgbToLinear(0.5)).toBeCloseTo(0.21404, 4)
	})
})

describe('oklch conversions', () => {
	it('matches CSS Color 4 reference values for red', () => {
		const oklch = rgbToOklch(red)
		expect(oklch.l).toBeCloseTo(0.627955, 4)
		expect(oklch.c).toBeCloseTo(0.257683, 4)
		expect(oklch.h).toBeCloseTo(29.2338, 2)
	})

	it('matches reference values for rebeccapurple', () => {
		const oklch = rgbToOklch(asRgb('rebeccapurple'))
		expect(oklch.l).toBeCloseTo(0.4403, 3)
		expect(oklch.c).toBeCloseTo(0.1603, 2)
		expect(oklch.h).toBeCloseTo(303.37, 1)
	})

	it('round-trips rgb -> oklch -> rgb within tolerance', () => {
		for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#123456', '#fafafa', '#663399']) {
			const input = asRgb(hex)
			const back = oklchToRgb(rgbToOklch(input))
			expect(back.r, hex).toBeCloseTo(input.r, 5)
			expect(back.g, hex).toBeCloseTo(input.g, 5)
			expect(back.b, hex).toBeCloseTo(input.b, 5)
		}
	})

	it('keeps white and black stable with hue normalized to 0 at zero chroma', () => {
		const white = rgbToOklch({ mode: 'rgb', r: 1, g: 1, b: 1, alpha: 1 })
		expect(white.l).toBeCloseTo(1, 4)
		expect(white.c).toBeCloseTo(0, 4)
		expect(white.h).toBe(0)
		const black = rgbToOklch({ mode: 'rgb', r: 0, g: 0, b: 0, alpha: 1 })
		expect(black.l).toBeCloseTo(0, 4)
		expect(black.c).toBeCloseTo(0, 4)
	})
})

describe('gamut mapping', () => {
	const vivid: OklchColor = { mode: 'oklch', l: 0.7, c: 0.35, h: 150, alpha: 1 }

	it('maps out-of-gamut oklch into srgb by chroma reduction, preserving hue and lightness', () => {
		expect(isInSrgbGamut(oklchToRgbUnmapped(vivid))).toBe(false)
		const mapped = oklchToRgb(vivid)
		expect(isInSrgbGamut(mapped)).toBe(true)
		const back = rgbToOklch(mapped)
		expect(back.h).toBeCloseTo(150, 0)
		expect(back.l).toBeCloseTo(0.7, 2)
		expect(back.c).toBeGreaterThan(0.15)
		expect(back.c).toBeLessThan(0.35)
	})

	it('preserves hue better than naive channel clamping', () => {
		const naive = oklchToRgbUnmapped(vivid)
		const clamped: RgbColor = {
			...naive,
			r: Math.min(1, Math.max(0, naive.r)),
			g: Math.min(1, Math.max(0, naive.g)),
			b: Math.min(1, Math.max(0, naive.b)),
		}
		const mappedHueError = Math.abs(rgbToOklch(oklchToRgb(vivid)).h - 150)
		const clampedHueError = Math.abs(rgbToOklch(clamped).h - 150)
		expect(mappedHueError).toBeLessThan(clampedHueError)
	})
})

describe('hsv', () => {
	it('round-trips and matches known values', () => {
		expect(rgbToHsv(red)).toMatchObject({ h: 0, s: 1, v: 1 })
		const back = hsvToRgb({ h: 0, s: 1, v: 1 }, 1)
		expect(back).toMatchObject({ r: 1, g: 0, b: 0 })
		const green = asRgb('#008000')
		const hsv = rgbToHsv(green)
		expect(hsv.h).toBeCloseTo(120, 5)
		expect(hsv.s).toBeCloseTo(1, 5)
		expect(hsv.v).toBeCloseTo(128 / 255, 5)
		const greenBack = hsvToRgb(hsv, 0.5)
		expect(greenBack.g).toBeCloseTo(green.g, 5)
		expect(greenBack.alpha).toBe(0.5)
	})
})
