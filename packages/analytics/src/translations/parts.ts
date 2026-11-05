/** Stands in for a value while a phrase is cut around it; no translation writes it. */
export const MARK = String.fromCharCode(0xe000)

/** A phrase cut where its value goes, so a surface can draw the value as its own markup. */
interface PhraseParts {
	before: string
	after: string
}

/**
 * A phrase filled with {@link MARK} for one value, cut at that mark. A phrase without it (a host
 * string that leaves the value out) is all `before`, and the value follows it.
 */
export const cutAtMark = (text: string): PhraseParts => {
	const at = text.indexOf(MARK)
	return at === -1
		? { before: text, after: '' }
		: { before: text.slice(0, at), after: text.slice(at + MARK.length) }
}

/** Unicode's first-strong isolate and its pop: a value keeps its own direction inside the text. */
export const isolate = (value: string): string => `⁨${value}⁩`
