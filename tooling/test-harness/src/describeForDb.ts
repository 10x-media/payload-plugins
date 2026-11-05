// biome-ignore-all lint/plugin/noProcessEnv: test harness env boundary (DB_MATRIX)
import { describe, it } from 'vitest'
import type { SupportedDb } from './bootPayload'

export interface DescribeForDbOptions {
	dbs?: SupportedDb[]
}

const SUPPORTED_DBS: readonly SupportedDb[] = ['mongo', 'postgres', 'sqlite']

const isSupportedDb = (value: string): value is SupportedDb =>
	SUPPORTED_DBS.some((db) => db === value)

/**
 * The lanes DB_MATRIX names (comma-separated), Mongo alone when it is unset. An unknown name
 * fails the run instead of silently booting something else.
 */
const matrixDbs = (raw: string | undefined): SupportedDb[] => {
	if (!raw) {
		return ['mongo']
	}
	const named = raw
		.split(',')
		.map((db) => db.trim())
		.filter((db) => db !== '')
	const unknown = named.filter((db) => !isSupportedDb(db))
	if (unknown.length > 0) {
		throw new Error(
			`DB_MATRIX names unknown databases (${unknown.join(', ')}); use ${SUPPORTED_DBS.join(', ')}`
		)
	}
	return named.filter(isSupportedDb)
}

const DEFAULT_DBS: SupportedDb[] = matrixDbs(process.env.DB_MATRIX)

/**
 * Runs the supplied describe block once per DB adapter. Each iteration gets
 * a fresh, named describe scope so reporters distinguish failures by DB.
 *
 * Override with the `dbs` option; otherwise respects the DB_MATRIX env var
 * (comma-separated, any of mongo, postgres, sqlite) and falls back to ['mongo'].
 */
export const describeForDb = (
	name: string,
	options: DescribeForDbOptions,
	fn: (db: SupportedDb) => void
): void => {
	const dbs = options.dbs ?? DEFAULT_DBS
	for (const db of dbs) {
		describe(`${name} [db=${db}]`, () => fn(db))
	}
}

/**
 * Asserts different expected values per DB adapter when behavior legitimately
 * diverges (e.g. Mongo lacks native cascade; Postgres has FKs). Name only the adapters
 * that differ and pass `fallback` for the rest; a DB with neither throws.
 */
export const expectForDb = <T>(
	db: SupportedDb,
	expectations: Partial<Record<SupportedDb, T>>,
	...fallback: [T] | []
): T => {
	const value = expectations[db]
	if (value !== undefined) {
		return value
	}
	if (fallback.length === 1) {
		return fallback[0]
	}
	throw new Error(`expectForDb: missing expectation for db=${db}`)
}

/**
 * Skips a single test for one DB. Wraps vitest's it.skip.
 */
// biome-ignore lint/complexity/useMaxParams: test helper signature mirrors vitest's it() shape
export const skipForDb = (
	skip: SupportedDb,
	current: SupportedDb,
	name: string,
	fn: () => Promise<void> | void
): void => {
	if (skip === current) {
		it.skip(name, fn)
	} else {
		it(name, fn)
	}
}
