/** Letters NFD cannot decompose; the ASCII filter would delete them outright. */
const LETTER_FOLDING: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	ø: 'o',
	œ: 'oe',
	ð: 'd',
	đ: 'd',
	þ: 'th',
	ł: 'l',
	ħ: 'h',
	ŋ: 'n',
	ı: 'i',
}

/**
 * Accents on a Latin or Greek letter, which writers drop (Greek in capitals). Cyrillic builds
 * letters of its own, й, ї and ў, the same way, so those marks stay.
 */
const ACCENTS = /(\p{Script=Latin}|\p{Script=Greek})[\u0300-\u036f]+/gu

/**
 * No Latin or Greek accents, ё as е, no case, single spaces. The marks other scripts spell
 * with (Cyrillic й and ї, Indic vowel signs, Arabic vowels, Japanese voicing) stay, recomposed,
 * so their words stay whole.
 */
export const foldText = (input: string): string =>
	input
		.normalize('NFC')
		.replace(/ё/g, 'е')
		.replace(/Ё/g, 'Е')
		.normalize('NFD')
		.replace(ACCENTS, '$1')
		.toLowerCase()
		.replace(/[ßæøœðđþłħŋı]/g, (char) => LETTER_FOLDING[char] ?? char)
		.replace(/\s+/g, ' ')
		.trim()
		.normalize('NFC')

/** `foldText` without punctuation, for comparing words. */
export const normalizeText = (input: string): string =>
	foldText(input)
		.normalize('NFD')
		.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.normalize('NFC')

export const tokens = (input: string): string[] => normalizeText(input).split(' ').filter(Boolean)

export const digits = (input: string): string => input.replace(/\D/g, '')

/** `YYYY-MM-DD` in UTC, or null when the value is not a date. */
export const dateParts = (value: unknown): { day: number; month: number; year: number } | null => {
	if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value)
		if (Number.isNaN(date.getTime())) return null
		return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
	}
	return null
}

export const dateKey = (parts: { day: number; month: number; year: number }): string =>
	`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`

/** Scalars out of whatever shape a field value arrives in: lists, locale maps, relationship objects. */
export const scalarsOf = (value: unknown): unknown[] => {
	if (value === null || value === undefined || value === '') return []
	if (Array.isArray(value)) return value.flatMap(scalarsOf)
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>
		// Two collections count their ids apart, so a polymorphic value keeps which one it is.
		if ('relationTo' in record && 'value' in record) {
			return scalarsOf(record.value).map((id) => `${String(record.relationTo)}:${String(id)}`)
		}
		if ('id' in record) return scalarsOf(record.id)
		return Object.values(record).flatMap(scalarsOf)
	}
	return [value]
}
