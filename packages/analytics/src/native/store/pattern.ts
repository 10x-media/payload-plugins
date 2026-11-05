import { InvalidQueryError } from '../../core/sourceErrors'
import { isInvalidPattern } from '../../db/errors'

/** The longest regular expression a `matches` filter may carry. */
export const MAX_PATTERN_LENGTH = 256

/** The largest repeat count a bound may name: what Postgres' regular expressions allow. */
const MAX_PATTERN_BOUND = 255

const SHORTHANDS: ReadonlySet<string> = new Set(['d', 'D', 'w', 'W', 's', 'S'])

/** Postgres refuses the negated shorthands inside a class. */
const CLASS_SHORTHANDS: ReadonlySet<string> = new Set(['d', 'w', 's'])

const QUANTIFIERS: ReadonlySet<string> = new Set(['*', '+', '?', '{'])

const ASCII_PUNCTUATION = /^[!-/:-@[-`{-~]$/

const ALPHANUMERIC = /^[A-Za-z0-9]$/

const isControl = (char: string): boolean => {
	const code = char.codePointAt(0) ?? 0
	return code < 0x20 || code === 0x7f
}

class Refusal extends Error {}

const refuse = (reason: string): never => {
	throw new Refusal(reason)
}

/** What a group holds, which decides whether repeating it could backtrack without end. */
interface Shape {
	quantified: boolean
	alternatives: boolean
}

interface Atom {
	repeatable: boolean
	inner?: Shape
}

/**
 * Why a `matches` pattern falls outside the subset JavaScript, Postgres `~*` and MongoDB `$regex`
 * read alike (and that cannot backtrack without end), or null for one inside it.
 */
export const patternRefusal = (pattern: string): string | null => {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return `takes at most ${MAX_PATTERN_LENGTH} characters`
	}
	const chars = [...pattern]
	let at = 0
	const peek = (): string | undefined => chars[at]

	const bound = (): void => {
		at += 1
		const digits = (): number | null => {
			let text = ''
			while (/^\d$/.test(peek() ?? '')) {
				text += peek()
				at += 1
			}
			return text === '' ? null : Number(text)
		}
		const least = digits()
		let most = least
		if (peek() === ',') {
			at += 1
			most = digits()
		}
		if (least === null || peek() !== '}') {
			refuse('a "{" that starts no {n}, {n,} or {n,m} bound: escape it')
		}
		at += 1
		if ((least ?? 0) > MAX_PATTERN_BOUND || (most ?? 0) > MAX_PATTERN_BOUND) {
			refuse(`a bound above ${MAX_PATTERN_BOUND}`)
		}
		if (most !== null && least !== null && most < least) {
			refuse('a bound whose numbers are out of order')
		}
	}

	const escapeIn = (inClass: boolean): { literal: boolean } => {
		at += 1
		const char = peek()
		if (char === undefined) {
			return refuse('a trailing backslash')
		}
		at += 1
		if (SHORTHANDS.has(char)) {
			if (inClass && !CLASS_SHORTHANDS.has(char)) {
				refuse(`\\${char} inside a class`)
			}
			return { literal: false }
		}
		if (ALPHANUMERIC.test(char) || !ASCII_PUNCTUATION.test(char)) {
			refuse(`the escape \\${char}`)
		}
		return { literal: true }
	}

	const charClass = (): void => {
		at += 1
		if (peek() === '^') {
			at += 1
		}
		if (peek() === ']') {
			refuse('a "]" first in a class: escape it')
		}
		let first = true
		let previous: string | null = null
		let afterRange = false
		for (;;) {
			const char = peek()
			if (char === undefined) {
				refuse('a class that is never closed')
				return
			}
			if (char === ']') {
				at += 1
				return
			}
			if (char === '[') {
				refuse('a "[" inside a class: escape it')
			}
			if (isControl(char)) {
				refuse('a control character')
			}
			if (char === '\\') {
				escapeIn(true)
				first = false
				previous = null
				afterRange = false
				continue
			}
			if (char === '-' && !first && chars[at + 1] !== ']') {
				if (afterRange) {
					refuse('a "-" right after a range: escape it')
				}
				const end = chars[at + 1]
				if (previous === null || end === undefined || end === '\\' || end === '[') {
					refuse('a "-" that joins no two plain characters: escape it')
					return
				}
				if (isControl(end)) {
					refuse('a control character')
				}
				const from = previous.codePointAt(0) ?? 0
				const to = end.codePointAt(0) ?? 0
				if (to < from) {
					refuse(`the range ${previous}-${end} runs backwards`)
				}
				at += 2
				first = false
				previous = null
				afterRange = true
				continue
			}
			at += 1
			first = false
			previous = char
			afterRange = false
		}
	}

	const atom = (): Atom => {
		const char = peek() ?? ''
		if (char === '^' || char === '$') {
			at += 1
			return { repeatable: false }
		}
		if (char === '(') {
			at += 1
			if (peek() === '?') {
				if (chars[at + 1] !== ':') {
					refuse('a group other than (...) and (?:...)')
				}
				at += 2
			}
			if (peek() === ')') {
				refuse('an empty group')
			}
			const inner = alternatives()
			if (peek() !== ')') {
				refuse('a group that is never closed')
			}
			at += 1
			return { repeatable: true, inner }
		}
		if (char === '[') {
			charClass()
			return { repeatable: true }
		}
		if (char === '\\') {
			escapeIn(false)
			return { repeatable: true }
		}
		if (QUANTIFIERS.has(char)) {
			return refuse(`a "${char}" with nothing to repeat`)
		}
		if (char === '}' || char === ']') {
			return refuse(`an unpaired "${char}": escape it`)
		}
		if (isControl(char)) {
			return refuse('a control character')
		}
		at += 1
		return { repeatable: true }
	}

	const sequence = (): { empty: boolean; quantified: boolean } => {
		let empty = true
		let quantified = false
		while (at < chars.length && peek() !== '|' && peek() !== ')') {
			const found = atom()
			empty = false
			quantified ||= found.inner?.quantified ?? false
			if (!QUANTIFIERS.has(peek() ?? '')) {
				continue
			}
			if (!found.repeatable) {
				refuse('a quantifier after an anchor')
			}
			if (found.inner && (found.inner.quantified || found.inner.alternatives)) {
				refuse('a repeated group holding a quantifier or an alternative')
			}
			if (peek() === '{') {
				bound()
			} else {
				at += 1
			}
			quantified = true
			if (QUANTIFIERS.has(peek() ?? '')) {
				refuse('a quantifier right after another: lazy and possessive ones are not read alike')
			}
		}
		return { empty, quantified }
	}

	const alternatives = (): Shape => {
		const shape: Shape = { quantified: false, alternatives: false }
		for (;;) {
			const branch = sequence()
			if (branch.empty && (shape.alternatives || peek() === '|')) {
				refuse('an empty alternative')
			}
			shape.quantified ||= branch.quantified
			if (peek() !== '|') {
				return shape
			}
			at += 1
			shape.alternatives = true
		}
	}

	try {
		alternatives()
		if (at < chars.length) {
			refuse('a ")" that closes no group: escape it')
		}
		return null
	} catch (err) {
		if (err instanceof Refusal) {
			return err.message
		}
		throw err
	}
}

/** Refuses a pattern {@link patternRefusal} refuses, as endpoints answer `400 invalid_param`. */
export const checkMatchesPattern = (pattern: string): void => {
	const refusal = patternRefusal(pattern)
	if (refusal !== null) {
		throw new InvalidQueryError(
			`analytics: the matches pattern "${pattern}" is refused: ${refusal}`,
			'filters'
		)
	}
}

/** A database's refusal of a read's regular expression as the query's fault; else the error. */
export const patternFault = (err: unknown): unknown =>
	isInvalidPattern(err)
		? new InvalidQueryError(
				'analytics: the database refused the matches pattern as a regular expression',
				'filters',
				{ cause: err }
			)
		: err
