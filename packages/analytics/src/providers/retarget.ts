import type { CollectionBeforeChangeHook } from 'payload'
import { cloudAppHost } from '../adapters/posthog/cloud'
import { isRecord, valueAt } from '../core/values'
import type { ProviderId } from './ids'
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

/** The PostHog fields that decide where its reads, and so its personal key, go. */
const POSTHOG_READ_PATHS = new Set(['posthog.host', 'posthog.region'])

/**
 * Where PostHog reads with these settings, as the adapter resolves it: the Host, else the Region's
 * cloud, US when blank. A field the update leaves out keeps its stored value.
 */
const posthogReadHost = (data: Doc, originalDoc: Doc): string => {
	const at = (path: string): string | null => {
		const next = valueAt(data, path)
		return comparable(next === undefined ? valueAt(originalDoc, path) : next)
	}
	const region = at('posthog.region')
	return at('posthog.host')?.replace(/\/+$/, '') ?? cloudAppHost(region === 'eu' ? 'eu' : 'us')
}

/** Which providers an update moves: every one on a new `provider` or scope, else those whose host or id changed. */
const movedBy = (
	data: Doc,
	originalDoc: Doc,
	scopeField: string
): { everyProvider: boolean; retargeted: ReadonlySet<ProviderId> } => {
	const moved = (path: string): boolean => {
		const next = valueAt(data, path)
		return next !== undefined && comparable(next) !== comparable(valueAt(originalDoc, path))
	}
	const retargeted = new Set<ProviderId>()
	for (const { provider, path } of CONNECTION_PATHS) {
		if (provider !== null && !POSTHOG_READ_PATHS.has(path) && moved(path)) {
			retargeted.add(provider)
		}
	}
	if (posthogReadHost(data, originalDoc) !== posthogReadHost(originalDoc, originalDoc)) {
		retargeted.add('posthog')
	}
	return { everyProvider: moved('provider') || moved(scopeField), retargeted }
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
		const { everyProvider, retargeted } = movedBy(data, originalDoc, args.scopeField)
		let next: Doc = data
		for (const { provider, path } of SECRET_PATHS) {
			const reached = everyProvider || retargeted.has(provider)
			if (reached && !freshlySent(valueAt(next, path), args.isSealed)) {
				next = withCleared(next, path)
			}
		}
		return next
	}

/**
 * Whether an update changes how a document connects: where it connects, as {@link retargetSecrets}
 * reads it, or a secret sent anew in plaintext. Its last connection result is about the old setup.
 */
export const reconnects = (
	args: RetargetArgs & { data: unknown; originalDoc: unknown }
): boolean => {
	if (!isRecord(args.data) || !isRecord(args.originalDoc)) {
		return false
	}
	const { everyProvider, retargeted } = movedBy(args.data, args.originalDoc, args.scopeField)
	const data = args.data
	return (
		everyProvider ||
		retargeted.size > 0 ||
		SECRET_PATHS.some(({ path }) => freshlySent(valueAt(data, path), args.isSealed))
	)
}
