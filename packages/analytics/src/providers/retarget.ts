import type { CollectionBeforeChangeHook } from 'payload'
import { isRecord, valueAt } from '../core/values'
import type { ProviderId } from './factory'
import { CONNECTION_PATHS, SECRET_PATHS } from './secrets'

interface RetargetArgs {
	/** The field a document's scope is stored in, a connection value like the rest. */
	scopeField: string
	/** The fields plugin's own test for a value it sealed. */
	isSealed: (value: unknown) => boolean
}

type Doc = Record<string, unknown>

/** A connection value as compared: blank is no value, and a relationship is its id. */
const comparable = (value: unknown): string | null => {
	if (isRecord(value)) {
		return comparable(value.id ?? value.value)
	}
	if (typeof value === 'string') {
		return value.trim() === '' ? null : value.trim()
	}
	return typeof value === 'number' ? String(value) : null
}

/** A secret the request sent itself, in plaintext: the only kind a retarget keeps. */
const freshlySent = (value: unknown, isSealed: RetargetArgs['isSealed']): boolean =>
	typeof value === 'string' && value !== '' && !isSealed(value)

/** `doc` with one secret set to null; a doc whose group is missing is left as it is. */
const withCleared = (doc: Doc, path: string): Doc => {
	const [group, field] = path.split('.')
	if (group === undefined || field === undefined) {
		return doc
	}
	const current = doc[group]
	return isRecord(current) ? { ...doc, [group]: { ...current, [field]: null } } : doc
}

/**
 * On an update that changes where a document connects, nulls every secret not resent in plaintext:
 * a changed `provider` or scope reaches all providers, a changed host or id only its own.
 */
export const retargetSecrets =
	(args: RetargetArgs): CollectionBeforeChangeHook =>
	({ data, operation, originalDoc }) => {
		if (operation !== 'update' || !isRecord(data) || !isRecord(originalDoc)) {
			return data
		}
		const moved = (path: string): boolean => {
			const next = valueAt(data, path)
			return next !== undefined && comparable(next) !== comparable(valueAt(originalDoc, path))
		}
		const everyProvider = moved('provider') || moved(args.scopeField)
		const retargeted = new Set<ProviderId>()
		for (const { provider, path } of CONNECTION_PATHS) {
			if (provider !== null && moved(path)) {
				retargeted.add(provider)
			}
		}
		let next: Doc = data
		for (const { provider, path } of SECRET_PATHS) {
			const reached = everyProvider || retargeted.has(provider)
			if (reached && !freshlySent(valueAt(next, path), args.isSealed)) {
				next = withCleared(next, path)
			}
		}
		return next
	}
