// biome-ignore-all lint/plugin/noProcessEnv: test harness env boundary (DB_MATRIX)
import { describe, it } from 'vitest'
import type { SupportedDb } from './bootPayload'

export interface DescribeForDbOptions {
	dbs?: SupportedDb[]
}

const DEFAULT_DBS: SupportedDb[] = process.env.DB_MATRIX
	? (process.env.DB_MATRIX.split(',') as SupportedDb[])
	: ['mongo']

/**
 * Runs the supplied describe block once per DB adapter. Each iteration gets
 * a fresh, named describe scope so reporters distinguish failures by DB.
 *
 * Override with the `dbs` option; otherwise respects the DB_MATRIX env var
 * (comma-separated) and falls back to ['mongo'].
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
 * diverges (e.g. Mongo lacks native cascade; Postgres has FKs).
 */
export const expectForDb = <T>(db: SupportedDb, expectations: Record<SupportedDb, T>): T => {
	const value = expectations[db]
	if (value === undefined) {
		throw new Error(`expectForDb: missing expectation for db=${db}`)
	}
	return value
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
