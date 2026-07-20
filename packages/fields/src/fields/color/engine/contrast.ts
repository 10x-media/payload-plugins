import { srgbToLinear, toRgb } from './convert'
import { parseColor } from './parse'
import type { ParsedColor } from './types'

const resolve = (input: ParsedColor | string): ParsedColor => {
	const parsed = typeof input === 'string' ? parseColor(input) : input
	if (!parsed) throw new TypeError(`Unparseable color: ${String(input)}`)
	return parsed
}

/** WCAG 2.x relative luminance of a color (alpha ignored). */
export const relativeLuminance = (input: ParsedColor | string): number => {
	const rgb = toRgb(resolve(input))
	return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b)
}

/** WCAG 2.x contrast ratio between two colors, in [1, 21]. Order-independent. */
export const contrastRatio = (a: ParsedColor | string, b: ParsedColor | string): number => {
	const la = relativeLuminance(a)
	const lb = relativeLuminance(b)
	const lighter = Math.max(la, lb)
	const darker = Math.min(la, lb)
	return (lighter + 0.05) / (darker + 0.05)
}
