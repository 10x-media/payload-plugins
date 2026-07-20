import { namedColors } from './namedColors'
import { parseColor } from './parse'

const HEX_DIGIT_RE = /[0-9a-f]/i
const LETTER_RE = /[a-z]/i
const WORD_CHAR_RE = /[0-9a-z]/i
const BARE_HEX_RE = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FN_HEAD_RE = /^(?:rgba?|hsla?|oklch)\(/i
const HEX_LENGTHS = [8, 6, 4, 3]

const hexRunLength = (input: string, from: number): number => {
	let end = from
	while (HEX_DIGIT_RE.test(input.charAt(end))) end += 1
	return end - from
}

const balancedParenEnd = (input: string, open: number): null | number => {
	let depth = 0
	for (let i = open; i < input.length; i += 1) {
		const char = input.charAt(i)
		if (char === '(') depth += 1
		else if (char === ')') {
			depth -= 1
			if (depth === 0) return i
		}
	}
	return null
}

/** Candidate color tokens starting at `index`, longest first. Only whole tokens the user actually typed. */
const candidatesAt = (input: string, index: number): string[] => {
	const char = input.charAt(index)
	if (char === '#') {
		const run = hexRunLength(input, index + 1)
		return HEX_LENGTHS.filter((length) => length <= run).map((length) =>
			input.slice(index, index + 1 + length)
		)
	}
	if (!LETTER_RE.test(char)) return []
	if (index > 0 && WORD_CHAR_RE.test(input.charAt(index - 1))) return []
	const fn = FN_HEAD_RE.exec(input.slice(index))
	if (fn) {
		const end = balancedParenEnd(input, index + fn[0].length - 1)
		return end === null ? [] : [input.slice(index, end + 1)]
	}
	let end = index
	while (LETTER_RE.test(input.charAt(end))) end += 1
	if (WORD_CHAR_RE.test(input.charAt(end))) return []
	const word = input.slice(index, end)
	const lower = word.toLowerCase()
	return lower === 'transparent' || namedColors[lower] !== undefined ? [word] : []
}

/**
 * Recovers the first valid color from dirty input: double pastes
 * ('#0f172a#0f172a'), surrounding junk ('color: rgb(14 165 233);'), or a bare
 * hex missing its '#'. Extracts candidate tokens (hex runs, balanced color
 * functions, whole-word named colors) instead of stripping characters, so it
 * never fabricates a color the user did not type. Valid input is returned
 * trimmed but otherwise unchanged; unrecoverable input returns null.
 */
export const salvageColor = (input: string): null | string => {
	const trimmed = input.trim()
	if (trimmed === '') return null
	if (parseColor(trimmed)) return trimmed
	for (let i = 0; i < trimmed.length; i += 1) {
		for (const candidate of candidatesAt(trimmed, i)) {
			if (parseColor(candidate)) return candidate
		}
	}
	if (BARE_HEX_RE.test(trimmed)) {
		const promoted = `#${trimmed}`
		if (parseColor(promoted)) return promoted
	}
	return null
}
