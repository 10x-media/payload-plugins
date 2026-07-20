import type { Hsl, Hsv, Oklab, OklchColor, ParsedColor, RgbColor } from './types'

export const srgbToLinear = (channel: number): number =>
	channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

export const linearToSrgb = (channel: number): number =>
	channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055

/** Standard CSS Color 4 / Ottosson OKLab matrices. */
export const rgbToOklab = (color: RgbColor): Oklab => {
	const r = srgbToLinear(color.r)
	const g = srgbToLinear(color.g)
	const b = srgbToLinear(color.b)
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	}
}

export const oklabToRgb = (lab: Oklab, alpha = 1): RgbColor => {
	const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3
	const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3
	const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3
	return {
		mode: 'rgb',
		r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
		alpha,
	}
}

export const rgbToOklch = (color: RgbColor): OklchColor => {
	const lab = rgbToOklab(color)
	const c = Math.hypot(lab.a, lab.b)
	let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
	if (h < 0) h += 360
	// Hue is meaningless at zero chroma; pin it so formatting is stable
	if (c < 1e-6) h = 0
	return { mode: 'oklch', l: lab.l, c, h, alpha: color.alpha }
}

/** Direct OKLCH to sRGB conversion; channels may fall outside [0, 1]. */
export const oklchToRgbUnmapped = (color: OklchColor): RgbColor => {
	const rad = (color.h * Math.PI) / 180
	return oklabToRgb(
		{ l: color.l, a: color.c * Math.cos(rad), b: color.c * Math.sin(rad) },
		color.alpha
	)
}

const GAMUT_EPSILON = 1e-5

export const isInSrgbGamut = (color: RgbColor): boolean =>
	[color.r, color.g, color.b].every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON)

const clip = (value: number): number => Math.min(1, Math.max(0, value))

export const clipToSrgb = (color: RgbColor): RgbColor => ({
	...color,
	r: clip(color.r),
	g: clip(color.g),
	b: clip(color.b),
})

/**
 * OKLCH to sRGB with CSS-style gamut mapping: chroma is reduced at constant
 * lightness and hue via binary search until the color fits, then clipped for
 * numeric noise. Never a naive per-channel clamp.
 */
export const oklchToRgb = (color: OklchColor): RgbColor => {
	const direct = oklchToRgbUnmapped(color)
	if (isInSrgbGamut(direct)) return clipToSrgb(direct)
	if (color.l <= 0) return { mode: 'rgb', r: 0, g: 0, b: 0, alpha: color.alpha }
	if (color.l >= 1) return { mode: 'rgb', r: 1, g: 1, b: 1, alpha: color.alpha }
	let lo = 0
	let hi = color.c
	for (let i = 0; i < 24; i += 1) {
		const mid = (lo + hi) / 2
		if (isInSrgbGamut(oklchToRgbUnmapped({ ...color, c: mid }))) lo = mid
		else hi = mid
	}
	return clipToSrgb(oklchToRgbUnmapped({ ...color, c: lo }))
}

export const toRgb = (color: ParsedColor): RgbColor =>
	color.mode === 'rgb' ? color : oklchToRgb(color)

export const toOklch = (color: ParsedColor): OklchColor =>
	color.mode === 'oklch' ? color : rgbToOklch(color)

export const hslToRgb = ({ h, l, s }: Hsl, alpha = 1): RgbColor => {
	const c = (1 - Math.abs(2 * l - 1)) * s
	const hp = (((h % 360) + 360) % 360) / 60
	const x = c * (1 - Math.abs((hp % 2) - 1))
	let r = 0
	let g = 0
	let b = 0
	if (hp < 1) [r, g, b] = [c, x, 0]
	else if (hp < 2) [r, g, b] = [x, c, 0]
	else if (hp < 3) [r, g, b] = [0, c, x]
	else if (hp < 4) [r, g, b] = [0, x, c]
	else if (hp < 5) [r, g, b] = [x, 0, c]
	else [r, g, b] = [c, 0, x]
	const m = l - c / 2
	return { mode: 'rgb', r: r + m, g: g + m, b: b + m, alpha }
}

export const rgbToHsl = (color: RgbColor): Hsl => {
	const { b, g, r } = color
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const d = max - min
	const l = (max + min) / 2
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
	let h = 0
	if (d !== 0) {
		if (max === r) h = 60 * (((g - b) / d) % 6)
		else if (max === g) h = 60 * ((b - r) / d + 2)
		else h = 60 * ((r - g) / d + 4)
	}
	if (h < 0) h += 360
	return { h, s, l }
}

export const rgbToHsv = (color: RgbColor): Hsv => {
	const { b, g, r } = color
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const d = max - min
	let h = 0
	if (d !== 0) {
		if (max === r) h = 60 * (((g - b) / d) % 6)
		else if (max === g) h = 60 * ((b - r) / d + 2)
		else h = 60 * ((r - g) / d + 4)
	}
	if (h < 0) h += 360
	return { h, s: max === 0 ? 0 : d / max, v: max }
}

export const hsvToRgb = ({ h, s, v }: Hsv, alpha = 1): RgbColor => {
	const c = v * s
	const hp = (((h % 360) + 360) % 360) / 60
	const x = c * (1 - Math.abs((hp % 2) - 1))
	let r = 0
	let g = 0
	let b = 0
	if (hp < 1) [r, g, b] = [c, x, 0]
	else if (hp < 2) [r, g, b] = [x, c, 0]
	else if (hp < 3) [r, g, b] = [0, c, x]
	else if (hp < 4) [r, g, b] = [0, x, c]
	else if (hp < 5) [r, g, b] = [x, 0, c]
	else [r, g, b] = [c, 0, x]
	const m = v - c
	return { mode: 'rgb', r: r + m, g: g + m, b: b + m, alpha }
}
