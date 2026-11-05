import { describe, expect, it } from 'vitest'
import { dbKind, isD1, knownDbKind } from './kind'

const adapterNamed = (name: string, packageName?: string) => ({
	db: { name, ...(packageName ? { packageName } : {}) },
})

describe('dbKind', () => {
	it.each([
		['mongoose', 'mongo'],
		['postgres', 'postgres'],
		['vercel-postgres', 'postgres'],
		['sqlite', 'sqlite'],
	])('reads the %s adapter as %s', (name, kind) => {
		expect(dbKind(adapterNamed(name))).toBe(kind)
	})

	it('refuses an adapter outside the three families, naming it', () => {
		expect(() => dbKind(adapterNamed('firestore'))).toThrow(
			'analytics: the "firestore" database adapter is not supported; use MongoDB, Postgres or SQLite'
		)
	})

	it('treats inherited object keys as unknown rather than as a family', () => {
		expect(knownDbKind(adapterNamed('constructor'))).toBeUndefined()
		expect(knownDbKind(adapterNamed('firestore'))).toBeUndefined()
	})
})

describe('D1', () => {
	const initialized = adapterNamed('sqlite', '@payloadcms/db-d1-sqlite')
	const factory = adapterNamed('d1-sqlite')

	it('is told from libsql by its package, or by its factory name', () => {
		expect(isD1(initialized)).toBe(true)
		expect(isD1(factory)).toBe(true)
		expect(isD1(adapterNamed('sqlite', '@payloadcms/db-sqlite'))).toBe(false)
	})

	it('is no family the plugin claims, under either name', () => {
		expect(knownDbKind(initialized)).toBeUndefined()
		expect(knownDbKind(factory)).toBeUndefined()
		expect(() => dbKind(initialized)).toThrow(
			'analytics: Cloudflare D1 (@payloadcms/db-d1-sqlite) is not supported yet; use MongoDB, Postgres or SQLite'
		)
	})
})
