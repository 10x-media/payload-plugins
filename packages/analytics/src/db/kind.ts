import type { Payload } from 'payload'

/** The database family behind a Payload instance, which decides the dialect raw access speaks. */
export type DbKind = 'mongo' | 'postgres' | 'sqlite'

/** Only the adapter's names are read, so a fake in a test needs nothing else. */
export interface NamedAdapter {
	db: Pick<Payload['db'], 'name'> & Partial<Pick<Payload['db'], 'packageName'>>
}

/**
 * Initialized adapters name themselves `mongoose`, `postgres` (node-postgres, Vercel, PGlite) or
 * `sqlite`; the Vercel factory's own `vercel-postgres` is mapped too, so either can be passed.
 */
const KIND_BY_ADAPTER = new Map<string, DbKind>([
	['mongoose', 'mongo'],
	['postgres', 'postgres'],
	['vercel-postgres', 'postgres'],
	['sqlite', 'sqlite'],
])

const D1_PACKAGE = '@payloadcms/db-d1-sqlite'

/**
 * Cloudflare D1. Its initialized adapter calls itself `sqlite` and only its package name tells it
 * from libsql; the factory's own name is `d1-sqlite`.
 */
export const isD1 = (payload: NamedAdapter): boolean =>
	payload.db.packageName === D1_PACKAGE || payload.db.name === 'd1-sqlite'

/**
 * The family `payload.db` belongs to, or undefined for an adapter outside the three. D1 is not
 * one of them yet: it speaks SQLite, but nothing here has been tested against it.
 */
export const knownDbKind = (payload: NamedAdapter): DbKind | undefined =>
	isD1(payload) ? undefined : KIND_BY_ADAPTER.get(payload.db.name)

/** The family `payload.db` belongs to. An adapter outside the three throws, naming itself. */
export const dbKind = (payload: NamedAdapter): DbKind => {
	const kind = knownDbKind(payload)
	if (!kind) {
		throw new Error(
			isD1(payload)
				? `analytics: Cloudflare D1 (${D1_PACKAGE}) is not supported yet; use MongoDB, Postgres or SQLite`
				: `analytics: the "${payload.db.name}" database adapter is not supported; use MongoDB, Postgres or SQLite`
		)
	}
	return kind
}
