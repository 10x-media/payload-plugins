/** What a providers or goals document change tells the plugin about the scopes it touched. */
export interface ScopeChange {
	scope: string | null
	/** The scope the document was in before an update, so a move invalidates both. */
	previousScope?: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null

/**
 * A document's scope as the read paths spell it. An unscoped install has no scope field at
 * all, which reads as null, the same value its reads carry; a relationship-typed field can
 * arrive populated, so its id is taken rather than the object.
 */
export const docScope = (doc: unknown, scopeField: string): string | null => {
	if (!isRecord(doc)) {
		return null
	}
	const value = doc[scopeField]
	if (typeof value === 'string') {
		return value === '' ? null : value
	}
	if (typeof value === 'number') {
		return String(value)
	}
	if (isRecord(value)) {
		const id = value.id
		return typeof id === 'string' || typeof id === 'number' ? String(id) : null
	}
	return null
}
