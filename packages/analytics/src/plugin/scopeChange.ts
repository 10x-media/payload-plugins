import { isRecord } from '../core/values'

/** What a providers or goals document change tells the plugin about the scopes it touched. */
export interface ScopeChange {
	scope: string | null
	/** The scope the document was in before an update, so a move invalidates both. */
	previousScope?: string | null
}

/** Every scope a change touched: the document's scope, and the one an update moved it out of. */
export const changedScopes = (change: ScopeChange): Array<string | null> =>
	change.previousScope === undefined || change.previousScope === change.scope
		? [change.scope]
		: [change.scope, change.previousScope]

/**
 * A document's scope as read paths spell it: a missing scope field reads as null, like unscoped
 * reads, and a populated relationship yields its id.
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
