import { hslToRgb } from './convert'
import { namedColors } from './namedColors'
import type { OklchColor, ParsedColor, RgbColor } from './types'

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const FN_RE = /^(rgba?|hsla?|oklch)\(\s*(.+?)\s*\)$/
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const parseNumberToken = (token: string): null | number => {
	if (!NUMBER_RE.test(token)) return null
	const value = Number.parseFloat(token)
	// Overflowing exponents like 1e400 pass the regex but parse to Infinity
	return Number.isFinite(value) ? value : null
}

/** Numeric token that may carry a % suffix. Returns the raw number plus whether it was a percentage. */
const parseMaybePercent = (token: string): null | { isPercent: boolean; value: number } => {
	const isPercent = token.endsWith('%')
	const value = parseNumberToken(isPercent ? token.slice(0, -1) : token)
	return value === null ? null : { isPercent, value }
}

const parseAlphaToken = (token: string | undefined): null | number => {
	if (token === undefined) return 1
	const parsed = parseMaybePercent(token)
	if (parsed === null) return null
	return clamp01(parsed.isPercent ? parsed.value / 100 : parsed.value)
}

const parseHue = (token: string): null | number => {
	const raw = token.endsWith('deg') ? token.slice(0, -3) : token
	const value = parseNumberToken(raw)
	if (value === null) return null
	return ((value % 360) + 360) % 360
}

const parseHex = (input: string): null | RgbColor => {
	if (!HEX_RE.test(input)) return null
	let hex = input.slice(1)
	if (hex.length <= 4) hex = [...hex].map((char) => char + char).join('')
	const pair = (from: number) => Number.parseInt(hex.slice(from, from + 2), 16)
	return {
		mode: 'rgb',
		r: pair(0) / 255,
		g: pair(2) / 255,
		b: pair(4) / 255,
		alpha: hex.length === 8 ? pair(6) / 255 : 1,
	}
}

/** Splits a function body into channel tokens and an optional alpha token (modern slash or legacy 4th arg). */
const splitArgs = (body: string): null | { alphaToken?: string; channels: string[] } => {
	const [main, ...slashParts] = body.split('/')
	if (slashParts.length > 1 || main === undefined) return null
	const trimmed = main.trim()
	if (trimmed === '') return null
	const channels = trimmed.split(trimmed.includes(',') ? /\s*,\s*/ : /\s+/)
	if (slashParts.length === 1) {
		const alphaToken = slashParts[0]?.trim()
		if (!alphaToken) return null
		return { alphaToken, channels }
	}
	if (channels.length === 4) return { alphaToken: channels[3], channels: channels.slice(0, 3) }
	return { channels }
}

const parseRgbBody = (channels: string[], alpha: number): null | RgbColor => {
	if (channels.length !== 3) return null
	const values: number[] = []
	for (const token of channels) {
		const parsed = parseMaybePercent(token)
		if (parsed === null) return null
		values.push(clamp01(parsed.isPercent ? parsed.value / 100 : parsed.value / 255))
	}
	const [r, g, b] = values
	if (r === undefined || g === undefined || b === undefined) return null
	return { mode: 'rgb', r, g, b, alpha }
}

const parseHslBody = (channels: string[], alpha: number): null | RgbColor => {
	if (channels.length !== 3) return null
	const [hToken, sToken, lToken] = channels
	if (hToken === undefined || sToken === undefined || lToken === undefined) return null
	const h = parseHue(hToken)
	const s = parseMaybePercent(sToken)
	const l = parseMaybePercent(lToken)
	if (h === null || s === null || l === null) return null
	if (!s.isPercent || !l.isPercent) return null
	return hslToRgb({ h, s: clamp01(s.value / 100), l: clamp01(l.value / 100) }, alpha)
}

const parseOklchBody = (channels: string[], alpha: number): null | OklchColor => {
	if (channels.length !== 3) return null
	const [lToken, cToken, hToken] = channels
	if (lToken === undefined || cToken === undefined || hToken === undefined) return null
	const l = parseMaybePercent(lToken)
	const c = parseMaybePercent(cToken)
	const h = parseHue(hToken)
	if (l === null || c === null || h === null) return null
	// A chroma percentage is relative to 0.4 per CSS Color 4
	const chroma = c.isPercent ? (c.value / 100) * 0.4 : c.value
	return {
		mode: 'oklch',
		l: clamp01(l.isPercent ? l.value / 100 : l.value),
		c: Math.max(0, chroma),
		h,
		alpha,
	}
}

/**
 * Parses a CSS color string: hex 3/4/6/8, rgb()/rgba() (legacy and modern syntax),
 * hsl()/hsla(), oklch(), the 148 named colors, and `transparent`.
 * Returns null for anything unparseable. Frontend-safe, zero dependencies.
 */
export const parseColor = (input: string): null | ParsedColor => {
	if (typeof input !== 'string') return null
	const value = input.trim().toLowerCase()
	if (value === '') return null
	if (value === 'transparent') return { mode: 'rgb', r: 0, g: 0, b: 0, alpha: 0 }
	const named = namedColors[value]
	if (named) return parseHex(named)
	if (value.startsWith('#')) return parseHex(value)
	const fn = FN_RE.exec(value)
	if (!fn) return null
	const [, name, body] = fn
	if (name === undefined || body === undefined) return null
	const args = splitArgs(body)
	if (!args) return null
	const alpha = parseAlphaToken(args.alphaToken)
	if (alpha === null) return null
	if (name === 'rgb' || name === 'rgba') return parseRgbBody(args.channels, alpha)
	if (name === 'hsl' || name === 'hsla') return parseHslBody(args.channels, alpha)
	return parseOklchBody(args.channels, alpha)
}
