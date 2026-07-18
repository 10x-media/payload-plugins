import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { readAadCandidates, sealAad } from './hooks'
import type { EncryptedFieldMarker } from './types'

const marker = (localized: boolean): EncryptedFieldMarker => ({
	fieldName: 'ssn',
	hasMany: false,
	localized,
	normalize: 'standard',
	queryable: false,
	sourceType: 'text',
})

const makeReq = (
	locale: string | undefined,
	localization: false | { defaultLocale: string; localeCodes: string[] }
): PayloadRequest =>
	({ locale, payload: { config: { localization } } }) as unknown as PayloadRequest

describe('sealAad binds slug.field[.locale] through buildAad', () => {
	it('non-localized fields bind slug.field', () => {
		expect(sealAad(marker(false), 'users', makeReq(undefined, false))).toBe('users.ssn')
	})

	it('localized fields append the request locale', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(sealAad(marker(true), 'users', makeReq('de', loc))).toBe('users.ssn.de')
	})

	it('localized fields fall back to the default locale when the request locale is all', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(sealAad(marker(true), 'users', makeReq('all', loc))).toBe('users.ssn.en')
	})
})

describe('readAadCandidates (Deviation 3: request locale first, then every configured locale)', () => {
	it('non-localized fields yield the single slug.field candidate', () => {
		expect(readAadCandidates(marker(false), 'users', makeReq(undefined, false))).toEqual([
			'users.ssn',
		])
	})

	it('localized fields try the request locale first, then the rest in config order', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(readAadCandidates(marker(true), 'users', makeReq('de', loc))).toEqual([
			'users.ssn.de',
			'users.ssn.en',
			'users.ssn.fr',
		])
	})

	it('locale=all reads try the default locale first', () => {
		const loc = { defaultLocale: 'en', localeCodes: ['en', 'de', 'fr'] }
		expect(readAadCandidates(marker(true), 'users', makeReq('all', loc))).toEqual([
			'users.ssn.en',
			'users.ssn.de',
			'users.ssn.fr',
		])
	})
})
