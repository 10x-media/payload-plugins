import type { ColorSchemeValue } from '../../types'
import { formatColor, isColorSchemeValue, parseColor } from './engine'

/** The single color a flat context uses for a scheme value. */
export const flatValue = (value: unknown): null | string => {
	if (isColorSchemeValue(value)) return value.light
	if (typeof value !== 'string' || value === '') return null
	return value
}

const normalizedCss = (value: string): string => {
	const parsed = parseColor(value)
	return parsed ? formatColor(parsed, 'rgb') : value
}

/**
 * Background for a swatch. A scheme value renders as a diagonal split so an
 * editor sees the color is mode-responsive without visiting the site.
 */
export const swatchBackground = (value: unknown): null | string => {
	if (isColorSchemeValue(value)) {
		const { dark, light } = value as ColorSchemeValue
		return `linear-gradient(135deg, ${normalizedCss(light)} 0 50%, ${normalizedCss(dark)} 50% 100%)`
	}
	const flat = flatValue(value)
	return flat === null ? null : normalizedCss(flat)
}
