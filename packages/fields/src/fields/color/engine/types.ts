import type { ColorFormat } from '../../../types'

export type RgbColor = { alpha: number; b: number; g: number; mode: 'rgb'; r: number }
export type OklchColor = { alpha: number; c: number; h: number; l: number; mode: 'oklch' }
export type ParsedColor = OklchColor | RgbColor

export type Hsl = { h: number; l: number; s: number }
export type Hsv = { h: number; s: number; v: number }
export type Oklab = { a: number; b: number; l: number }

export type FormatColorOptions = {
	/** Emit the alpha channel when below 1. Defaults to true; false strips alpha entirely. */
	alpha?: boolean
}

export type { ColorFormat }
