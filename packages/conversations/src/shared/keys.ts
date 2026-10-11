/**
 * Conversation keys and user keys are the wire format shared by the server,
 * the endpoints and every client. This module stays free of server-only
 * imports; the browser bundle uses it.
 *
 * A key names the target a conversation is bound to:
 * `collection:<slug>:<id>`, `global:<slug>` or `custom:<anything>`. A user key
 * names a user across auth collections: `<collection>:<id>`.
 */

export type TargetKind = 'collection' | 'custom' | 'global'

/** A key parsed into its parts. For `custom` keys `slug` is the prefix before the next `:`. */
export type ParsedKey = {
	/** The document id, for collection targets only. */
	id?: string
	key: string
	kind: TargetKind
	slug: string
}

export const collectionKey = (collection: string, id: number | string): string =>
	`collection:${collection}:${String(id)}`

export const globalKey = (global: string): string => `global:${global}`

export const customKey = (value: string): string => `custom:${value}`

/**
 * Parse a key, or return `null` for anything malformed. A custom key may itself
 * contain `:`; its `slug` is the text up to the first one, which is how custom
 * targets are declared (`targets.custom` is keyed by that prefix).
 */
export const parseKey = (key: unknown): ParsedKey | null => {
	if (typeof key !== 'string' || key.length > 512) {
		return null
	}
	const first = key.indexOf(':')
	if (first <= 0) {
		return null
	}
	const kind = key.slice(0, first)
	const rest = key.slice(first + 1)
	if (rest.length === 0) {
		return null
	}
	if (kind === 'global') {
		return rest.includes(':') ? null : { key, kind, slug: rest }
	}
	if (kind === 'custom') {
		const separator = rest.indexOf(':')
		return { key, kind, slug: separator === -1 ? rest : rest.slice(0, separator) }
	}
	if (kind === 'collection') {
		const separator = rest.indexOf(':')
		if (separator <= 0 || separator === rest.length - 1) {
			return null
		}
		return { id: rest.slice(separator + 1), key, kind, slug: rest.slice(0, separator) }
	}
	return null
}

/** A user across auth collections. */
export type UserRef = { collection: string; id: string }

export const userKey = (collection: string, id: number | string): string =>
	`${collection}:${String(id)}`

/** The prefix of a system author's key: `system:<name>`. No users collection may take it. */
export const SYSTEM_AUTHOR = 'system'

/** A system author's key, for messages server code posts in no person's name. */
export const systemKey = (name: string): string => `${SYSTEM_AUTHOR}:${name}`

/** The name of a system author's key, or null for anyone else. */
export const parseSystemKey = (value: unknown): null | string =>
	typeof value === 'string' && value.startsWith(`${SYSTEM_AUTHOR}:`) && value.length > 7
		? value.slice(SYSTEM_AUTHOR.length + 1)
		: null

export const parseUserKey = (value: unknown): UserRef | null => {
	if (typeof value !== 'string') {
		return null
	}
	const separator = value.indexOf(':')
	if (separator <= 0 || separator === value.length - 1) {
		return null
	}
	return { collection: value.slice(0, separator), id: value.slice(separator + 1) }
}
