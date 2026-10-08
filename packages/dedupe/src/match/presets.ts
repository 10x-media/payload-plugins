import type { CompareFn, ComparePreset, MatchFieldConfig } from '../options'
import { dateKey, dateParts, digits, foldText, tokens } from './normalize'
import { SIMILAR_THRESHOLD } from './score'
import { editDistance, tokenSimilarity } from './similarity'

/** Enough of a token to survive a typo further along the word, short enough to still block. */
const PREFIX_LENGTH = 4

/** Phone numbers compare on their tail so a country code present on one side only still matches. */
const PHONE_SUFFIX = 9

const asString = (value: unknown): string =>
	typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)

const tokenKeys = (parts: string[]): string[] => {
	if (parts.length === 0) return []
	const keys = new Set<string>([[...parts].sort().join('|')])
	for (const part of parts) {
		if (part.length >= 3) keys.add(`~${part.slice(0, PREFIX_LENGTH)}`)
	}
	return [...keys]
}

/** The same value ignoring case, Latin accents and spacing; punctuation counts. */
const exact: CompareFn = {
	keys: (value) => {
		const text = foldText(asString(value))
		return text ? [text] : []
	},
	similarity: (a, b) => (foldText(asString(a)) === foldText(asString(b)) ? 1 : 0),
}

/** Shorter words get no typo keys: one letter is too large a share of them to tell names apart. */
const TYPO_MIN_LENGTH = 4

/** The text and the text without each of its characters: two texts one edit apart share one. */
const oneEditKeys = (text: string): string[] => {
	const chars = [...text]
	return [text, ...chars.map((_, index) => chars.toSpliced(index, 1).join(''))]
}

type TextOptions = Pick<MatchFieldConfig, 'typos'>

/**
 * Words in any order; a word present on one side only makes the value similar, not the same.
 * The letters without spaces are a key too and a match on their own, so a name written as one
 * word or two ("Er Gen", "Ergen") meets and counts as the same. `typos` adds keys that meet a
 * word of four letters or more with one letter wrong, missing or extra.
 */
const textCompare = ({ typos = false }: TextOptions): CompareFn => ({
	keys: (value) => {
		const parts = tokens(asString(value))
		if (parts.length === 0) return []
		const keys = [...tokenKeys(parts), `=${parts.join('')}`]
		if (!typos) return keys
		const long = parts.filter((part) => [...part].length >= TYPO_MIN_LENGTH)
		return [...new Set([...keys, ...long.flatMap(oneEditKeys).map((key) => `-${key}`)])]
	},
	similarity: (a, b) => {
		const left = tokens(asString(a))
		const right = tokens(asString(b))
		if (left.length > 0 && left.join('') === right.join('')) return 1
		return tokenSimilarity(left, right)
	},
})

const phoneTail = (value: unknown): string => digits(asString(value)).slice(-PHONE_SUFFIX)

/**
 * Phone numbers: the last nine digits, at least six of them. Not for other numbers: two tax
 * or customer numbers sharing a tail would match.
 */
const phone: CompareFn = {
	keys: (value) => {
		const tail = phoneTail(value)
		return tail.length >= 6 ? [tail] : []
	},
	similarity: (a, b) => {
		const left = phoneTail(a)
		const right = phoneTail(b)
		return left.length >= 6 && left === right ? 1 : 0
	},
}

const date: CompareFn = {
	keys: (value) => {
		const parts = dateParts(value)
		if (!parts) return []
		const keys = [dateKey(parts)]
		// Both sides get the swapped form, so a date entered in the other order shares a key.
		if (parts.day <= 12 && parts.day !== parts.month) {
			keys.push(dateKey({ year: parts.year, month: parts.day, day: parts.month }))
		}
		return keys
	},
	similarity: (a, b) => {
		const left = dateParts(a)
		const right = dateParts(b)
		if (!left || !right) return 0
		if (left.year === right.year && left.month === right.month && left.day === right.day) return 1
		// Day and month entered the other way round: a typo, so above the similar threshold.
		if (left.year === right.year && left.month === right.day && left.day === right.month) return 0.9
		return 0
	},
}

const toNumber = (value: unknown): number | null => {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value !== 'string') return null
	const text = value.replace(/\s/g, '')
	const number = Number(text.includes('.') ? text.replace(/,/g, '') : text.replace(',', '.'))
	return text !== '' && Number.isFinite(number) ? number : null
}

/** Inside the tolerance a value is similar, from 1 when equal down to the threshold at its edge. */
const withinTolerance = (share: number, limit: number): number =>
	share <= limit ? 1 - (1 - SIMILAR_THRESHOLD) * (share / limit) : 0

/** Edits the blocking keys of `quantity` cover; more still score, but must meet by another key. */
const KEY_EDITS = 1

type Tolerance = Pick<MatchFieldConfig, 'tolerance' | 'toleranceType'>

/**
 * Numbers. Without a tolerance two values match when they are the same number however they
 * are written. `value` measures the difference against the larger of the two, `quantity`
 * the share of characters that differ, a typo in a customer number.
 */
const numberCompare = ({ tolerance = 0, toleranceType = 'value' }: Tolerance): CompareFn => {
	const limit = tolerance / 100
	if (toleranceType === 'quantity') {
		const chars = (value: unknown): string =>
			typeof value === 'number' ? String(value) : foldText(asString(value)).replace(/\s/g, '')
		return {
			keys: (value) => {
				const text = chars(value)
				if (!text) return []
				if (limit === 0) return [text]
				// One edit apart, two values share a key: the same character dropped from both, or
				// the longer one without its extra character against the shorter as it is.
				const edits = Math.min(KEY_EDITS, Math.floor(text.length * limit)) >= 1
				return [...new Set([text, ...(edits ? oneEditKeys(text) : [text]).map((key) => `~${key}`)])]
			},
			similarity: (a, b) => {
				const left = chars(a)
				const right = chars(b)
				if (!left || !right) return 0
				if (left === right) return 1
				if (limit === 0) return 0
				return withinTolerance(
					editDistance(left, right) / Math.max(left.length, right.length),
					limit
				)
			},
		}
	}
	// Two values within the tolerance are at most one bucket apart on a log scale, so each
	// files under its own bucket and the next one up.
	const width = limit > 0 && limit < 1 ? -Math.log(1 - limit) : 0
	return {
		keys: (value) => {
			const number = toNumber(value)
			if (number === null) return []
			if (number === 0) return ['0']
			const sign = number < 0 ? '-' : '+'
			if (limit >= 1) return [sign]
			if (width === 0) return [String(number)]
			const bucket = Math.floor(Math.log(Math.abs(number)) / width)
			return [`${sign}${bucket}`, `${sign}${bucket + 1}`]
		},
		similarity: (a, b) => {
			const left = toNumber(a)
			const right = toNumber(b)
			if (left === null || right === null) return 0
			if (left === right) return 1
			if (limit === 0) return 0
			return withinTolerance(
				Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right)),
				limit
			)
		},
	}
}

export const presets: Record<ComparePreset, CompareFn> = {
	exact,
	text: textCompare({}),
	phone,
	number: numberCompare({}),
	date,
}

export const resolveCompare = (
	compare: CompareFn | ComparePreset | undefined,
	options: Tolerance & TextOptions = {}
): CompareFn => {
	if (typeof compare === 'object') return compare
	if (compare === 'number' && (options.tolerance || options.toleranceType)) {
		return numberCompare(options)
	}
	if (compare === 'text' && options.typos) return textCompare(options)
	return presets[compare ?? 'exact']
}
