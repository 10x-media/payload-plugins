import type { LockWindow } from './types'

const iso = (value: unknown): string | null => {
	if (!(value instanceof Date) && (typeof value !== 'string' || value.length === 0)) {
		return null
	}
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

/**
 * Map a stored lock document to the runtime window shape. The document keeps
 * groups, collections and globals in separate fields; the window folds them
 * into prefixed `targets`. A document without `lockEverything` (the plugin has
 * nothing to select) locks everything.
 */
export const toWindow = (doc: Record<string, unknown>): LockWindow => ({
	id: String(doc.id),
	title: typeof doc.title === 'string' ? doc.title : '',
	announceAt: doc.announce === false ? null : iso(doc.announceAt),
	startsAt: iso(doc.startsAt) ?? new Date(0).toISOString(),
	endMode: doc.endAtTime === true ? 'at' : 'manual',
	endsAt: iso(doc.endsAt),
	endedAt: iso(doc.endedAt),
	scope: doc.lockEverything === false ? 'selected' : 'everything',
	targets: [
		...strings(doc.groups).map((key) => `group:${key}`),
		...strings(doc.collections).map((slug) => `collection:${slug}`),
		...strings(doc.globals).map((slug) => `global:${slug}`),
	],
})
