import type { ColorSchemeValue } from '../../../types'

/** Narrows the preset and resolved-value unions to a scheme-aware color. */
export const isColorSchemeValue = (value: unknown): value is ColorSchemeValue =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as Partial<ColorSchemeValue>).light === 'string' &&
	typeof (value as Partial<ColorSchemeValue>).dark === 'string'

/**
 * CSS for a scheme-aware color. Flat strings pass through unchanged. The
 * two-argument form needs `color-scheme` set on the element to resolve.
 */
export const lightDark = (value: ColorSchemeValue | string): string =>
	isColorSchemeValue(value) ? `light-dark(${value.light}, ${value.dark})` : value
