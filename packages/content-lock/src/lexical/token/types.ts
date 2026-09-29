import { keys, type TranslationKey } from '../../translations/keys'

export const TOKEN_NODE_TYPE = 'contentLockToken'
export const TOKEN_FEATURE_KEY = 'contentLockToken'

/**
 * What a token shows: one of the window's own timestamps, what it freezes, or a
 * fixed date. Everything but `date` is read from the window when the banner
 * renders, so rescheduling never leaves the text behind.
 */
export type TokenKind = 'startsAt' | 'endsAt' | 'announceAt' | 'scope' | 'date'

/** How a date token renders for the viewer. */
export type DateFormat = 'datetime' | 'date' | 'time' | 'relative'

export const TOKEN_KINDS: readonly TokenKind[] = [
	'startsAt',
	'endsAt',
	'announceAt',
	'scope',
	'date',
]

export const DATE_FORMATS: readonly DateFormat[] = ['datetime', 'date', 'time', 'relative']

/**
 * What a token node stores. `format` applies to every kind but `scope`; `date`
 * only to `date`. `textFormat` is Lexical's text format bitmask (bold,
 * italic, ...), so a token takes the same styling as the words around it.
 */
export type TokenData = {
	token: TokenKind
	format: DateFormat
	date?: string
	textFormat: number
}

/** Lexical's text format bits, the ones a token honours. */
export const TEXT_FORMAT_BITS = {
	bold: 1,
	italic: 1 << 1,
	strikethrough: 1 << 2,
	underline: 1 << 3,
} as const

export type TokenTextFormat = keyof typeof TEXT_FORMAT_BITS

export type SerializedTokenNode = TokenData & { type: typeof TOKEN_NODE_TYPE; version: 1 }

/** The window fields a token depends on, as a form or a document holds them. */
export type TokenWindowValues = {
	announceAt?: unknown
	endAtTime?: unknown
	lockEverything?: unknown
}

export const tokenKindLabel: Record<TokenKind, TranslationKey> = {
	startsAt: keys.tokenStartsAt,
	endsAt: keys.tokenEndsAt,
	announceAt: keys.tokenAnnounceAt,
	scope: keys.tokenScope,
	date: keys.tokenDate,
}

export const dateFormatLabel: Record<DateFormat, TranslationKey> = {
	datetime: keys.formatDatetime,
	date: keys.formatDate,
	time: keys.formatTime,
	relative: keys.formatRelative,
}

/**
 * Why a token cannot render for this window, as the translation key saying so,
 * or `null` when it can. The start always resolves: an empty one is stamped on
 * publish. The scope only exists when the window selects what it freezes.
 */
export const tokenProblem = (
	data: Pick<TokenData, 'token' | 'date'>,
	values: TokenWindowValues
): TranslationKey | null => {
	switch (data.token) {
		case 'startsAt':
			return null
		case 'endsAt':
			return values.endAtTime === true ? null : keys.tokenNoEnd
		case 'announceAt':
			return values.announceAt ? null : keys.tokenNoAnnouncement
		case 'scope':
			return values.lockEverything === false ? null : keys.tokenNoScope
		case 'date':
			return data.date ? null : keys.tokenNoDate
	}
}

/** Normalize a stored node, so an older or hand-written one still loads. */
export const tokenDataOf = (value: Partial<TokenData>): TokenData => ({
	textFormat: typeof value.textFormat === 'number' ? value.textFormat : 0,
	token: TOKEN_KINDS.includes(value.token as TokenKind) ? (value.token as TokenKind) : 'date',
	format: DATE_FORMATS.includes(value.format as DateFormat)
		? (value.format as DateFormat)
		: 'datetime',
	...(value.date ? { date: value.date } : {}),
})
