import { rgbToHsl, toOklch, toRgb } from './convert'
import { parseColor } from './parse'
import type { ColorFormat, FormatColorOptions, ParsedColor } from './types'

const trimNumber = (value: number, decimals: number): string => {
	const fixed = (Math.abs(value) < 1e-9 ? 0 : value).toFixed(decimals)
	if (!fixed.includes('.')) return fixed
	return fixed.replace(/0+$/, '').replace(/\.$/, '')
}

const channel255 = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255)

const hexPair = (value: number): string => channel255(value).toString(16).padStart(2, '0')

/**
 * Formats a parsed color as modern CSS syntax in the requested format.
 * Alpha is emitted only when below 1 (hex becomes 8-digit); `{ alpha: false }`
 * strips it entirely. OKLCH input emitted as an sRGB format is gamut-mapped.
 */
export const formatColor = (
	color: ParsedColor,
	format: ColorFormat,
	options: FormatColorOptions = {}
): string => {
	const alpha = options.alpha === false ? 1 : color.alpha
	const alphaText = trimNumber(alpha, 3)
	const suffix = alphaText === '1' ? '' : ` / ${alphaText}`
	switch (format) {
		case 'hex': {
			const rgb = toRgb(color)
			const base = `#${hexPair(rgb.r)}${hexPair(rgb.g)}${hexPair(rgb.b)}`
			const alphaPair = hexPair(alpha)
			return alphaPair === 'ff' ? base : `${base}${alphaPair}`
		}
		case 'hsl': {
			const hsl = rgbToHsl(toRgb(color))
			return `hsl(${trimNumber(hsl.h, 1)} ${trimNumber(hsl.s * 100, 1)}% ${trimNumber(hsl.l * 100, 1)}%${suffix})`
		}
		case 'oklch': {
			const oklch = toOklch(color)
			return `oklch(${trimNumber(oklch.l, 4)} ${trimNumber(oklch.c, 4)} ${trimNumber(oklch.h, 2)}${suffix})`
		}
		case 'rgb': {
			const rgb = toRgb(color)
			return `rgb(${channel255(rgb.r)} ${channel255(rgb.g)} ${channel255(rgb.b)}${suffix})`
		}
	}
}

/** parseColor + formatColor in one step. Returns null when the input does not parse. */
export const convertColor = (
	input: string,
	format: ColorFormat,
	options?: FormatColorOptions
): null | string => {
	const parsed = parseColor(input)
	return parsed ? formatColor(parsed, format, options) : null
}
