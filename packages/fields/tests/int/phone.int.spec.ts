import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { phoneNumberField } from '../../src/exports/phone'
import { fields } from '../../src/index'

type PgPoolLike = {
	query: (text: string, params?: unknown[]) => Promise<{ rows: Array<{ column_name: string }> }>
}

type MongoModelLike = {
	collection: {
		findOne: (filter: Record<string, unknown>) => Promise<Record<string, unknown> | null>
	}
}

const phoneRecords: CollectionConfig = {
	slug: 'phoneRecords',
	fields: [
		{ name: 'title', type: 'text' },
		phoneNumberField({ name: 'phone' }),
		phoneNumberField({ name: 'mobilePhone', validation: 'mobile' }),
		phoneNumberField({ name: 'possiblePhone', validation: 'possible' }),
		phoneNumberField({ name: 'phoneE164', storage: 'e164' }),
		phoneNumberField({ localized: true, name: 'localizedPhone' }),
		{
			name: 'contacts',
			type: 'array',
			fields: [{ name: 'role', type: 'text' }, phoneNumberField({ name: 'phone' })],
		},
	],
}

const requiredPhones: CollectionConfig = {
	slug: 'requiredPhones',
	fields: [{ name: 'title', type: 'text' }, phoneNumberField({ name: 'phone', required: true })],
}

const registryPhones: CollectionConfig = {
	slug: 'registryPhones',
	fields: [
		{ name: 'title', type: 'text' },
		phoneNumberField({ name: 'inherited', storage: 'e164' }),
		phoneNumberField({ name: 'pinnedValid', storage: 'e164', validation: 'valid' }),
	],
}

describeForDb('phone number field integration', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [phoneRecords, requiredPhones],
			configOverrides: {
				localization: { defaultLocale: 'en', fallback: true, locales: ['en', 'de'] },
			},
			db,
			plugin: fields({}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	describe('round trip and derived hook', () => {
		it('round-trips number and country and populates every virtual subfield without clobbering the persisted pair', async () => {
			// National-format input on purpose: its parsed e164 differs from the stored
			// string, so a hook that overwrote `number` (instead of enriching it) would fail.
			const created = await booted.payload.create({
				collection: 'phoneRecords',
				data: { phone: { country: 'DE', number: '0151 12345678' }, title: 'derived' },
			})
			const found = await booted.payload.findByID({ collection: 'phoneRecords', id: created.id })
			expect(found.phone).toMatchObject({
				callingCode: '49',
				country: 'DE',
				international: '+49 1511 2345678',
				national: '01511 2345678',
				number: '0151 12345678',
				type: 'MOBILE',
				uri: 'tel:+4915112345678',
			})
		})
	})

	describe('raw storage', () => {
		it('keeps the five virtual subfields out of the raw stored row, not merely the API response', async () => {
			await booted.payload.create({
				collection: 'phoneRecords',
				data: { phone: { country: 'DE', number: '+4915112345678' }, title: 'raw-row-check' },
			})

			if (db === 'postgres') {
				const pool = (booted.payload.db as unknown as { pool: PgPoolLike }).pool
				const candidates = [
					'phone_number',
					'phone_country',
					'phone_national',
					'phone_international',
					'phone_calling_code',
					'phone_uri',
					'phone_type',
				]
				const { rows } = await pool.query(
					'select column_name from information_schema.columns where table_name = $1 and column_name = any($2::text[])',
					['phone_records', candidates]
				)
				expect(rows.map((row) => row.column_name).sort()).toEqual(['phone_country', 'phone_number'])
				return
			}

			const model = (
				booted.payload.db as unknown as { collections: { phoneRecords: MongoModelLike } }
			).collections.phoneRecords
			const raw = await model.collection.findOne({ title: 'raw-row-check' })
			const phone = (raw as { phone: Record<string, unknown> }).phone
			expect(phone.number).toBe('+4915112345678')
			expect(phone.country).toBe('DE')
			expect(phone.national).toBeUndefined()
			expect(phone.international).toBeUndefined()
			expect(phone.callingCode).toBeUndefined()
			expect(phone.uri).toBeUndefined()
			expect(phone.type).toBeUndefined()
		})
	})

	describe('validation per mode', () => {
		it('rejects a malformed number under the default valid mode', async () => {
			await expect(
				booted.payload.create({
					collection: 'phoneRecords',
					data: { phone: { country: 'DE', number: 'not a phone number' }, title: 'invalid-valid' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({ message: 'Enter a valid phone number.', path: 'phone' }),
					]),
				},
			})
		})

		it('accepts a number that only passes possible-length checks, which valid mode would reject', async () => {
			const doc = await booted.payload.create({
				collection: 'phoneRecords',
				data: {
					possiblePhone: { country: 'DE', number: '+49151123456781234' },
					title: 'possible-long',
				},
			})
			expect(doc.possiblePhone).toMatchObject({ number: '+49151123456781234' })
		})

		it('still rejects unparseable input under possible mode', async () => {
			await expect(
				booted.payload.create({
					collection: 'phoneRecords',
					data: { possiblePhone: { country: 'DE', number: '+4915' }, title: 'possible-short' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({
							message: 'Enter a valid phone number.',
							path: 'possiblePhone',
						}),
					]),
				},
			})
		})

		it('accepts a genuine mobile number under mobile-only validation', async () => {
			const doc = await booted.payload.create({
				collection: 'phoneRecords',
				data: {
					mobilePhone: { country: 'DE', number: '+4915112345678' },
					title: 'mobile-ok',
				},
			})
			expect(doc.mobilePhone).toMatchObject({ number: '+4915112345678', type: 'MOBILE' })
		})

		it('rejects a landline as not-mobile under mobile-only validation', async () => {
			await expect(
				booted.payload.create({
					collection: 'phoneRecords',
					data: {
						mobilePhone: { country: 'DE', number: '+49301234567' },
						title: 'mobile-landline',
					},
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({
							message: 'Enter a mobile phone number.',
							path: 'mobilePhone',
						}),
					]),
				},
			})
		})
	})

	describe('required', () => {
		it('rejects an empty group, which native required on a group would not catch', async () => {
			// {} is present, not undefined, so native group `required` is satisfied. Only the
			// factory's own validate, which inspects `number`, can reject this.
			await expect(
				booted.payload.create({
					collection: 'requiredPhones',
					data: { phone: {}, title: 'required-empty' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({ message: 'This field is required.', path: 'phone' }),
					]),
				},
			})

			const ok = await booted.payload.create({
				collection: 'requiredPhones',
				data: { phone: { country: 'DE', number: '+4915112345678' }, title: 'required-ok' },
			})
			expect(ok.phone).toMatchObject({ number: '+4915112345678' })
		})
	})

	describe('e164 storage', () => {
		it('round-trips a valid e164-ish string exactly as written, with no server-side normalization', async () => {
			// Deliberately not canonical e164 (has spaces): its own parsed e164 is
			// '+4915112345678', so a normalizing hook would silently rewrite this.
			const created = await booted.payload.create({
				collection: 'phoneRecords',
				data: { phoneE164: '+49 1511 2345678', title: 'e164-round-trip' },
			})
			const found = await booted.payload.findByID({ collection: 'phoneRecords', id: created.id })
			expect(found.phoneE164).toBe('+49 1511 2345678')
		})

		it('rejects malformed input the same way as object storage', async () => {
			await expect(
				booted.payload.create({
					collection: 'phoneRecords',
					data: { phoneE164: 'not a phone number', title: 'e164-invalid' },
				})
			).rejects.toMatchObject({
				data: {
					errors: expect.arrayContaining([
						expect.objectContaining({ message: 'Enter a valid phone number.', path: 'phoneE164' }),
					]),
				},
			})
		})
	})

	describe('query and sort', () => {
		it('filters on phone.country and sorts on phone.number', async () => {
			// FR and CH are reserved to this test so the filter and sort order stay
			// deterministic whatever else the suite created.
			await booted.payload.create({
				collection: 'phoneRecords',
				data: { phone: { country: 'FR', number: '+33612345678' }, title: 'query-fr' },
			})
			await booted.payload.create({
				collection: 'phoneRecords',
				data: { phone: { country: 'CH', number: '+41446681800' }, title: 'query-ch' },
			})

			const filtered = await booted.payload.find({
				collection: 'phoneRecords',
				where: { 'phone.country': { equals: 'CH' } },
			})
			expect(filtered.docs.map((doc) => doc.title)).toEqual(['query-ch'])

			const sorted = await booted.payload.find({
				collection: 'phoneRecords',
				sort: 'phone.number',
				where: { 'phone.country': { in: ['CH', 'FR'] } },
			})
			expect(sorted.docs.map((doc) => doc.title)).toEqual(['query-fr', 'query-ch'])
		})
	})

	describe('localized', () => {
		it('stores localizedPhone independently per locale and merges under locale all', async () => {
			const created = await booted.payload.create({
				collection: 'phoneRecords',
				data: {
					localizedPhone: { country: 'DE', number: '+4915112345678' },
					title: 'localized',
				},
				locale: 'en',
			})
			await booted.payload.update({
				collection: 'phoneRecords',
				data: { localizedPhone: { country: 'US', number: '+12015550123' } },
				id: created.id,
				locale: 'de',
			})

			const en = await booted.payload.findByID({
				collection: 'phoneRecords',
				id: created.id,
				locale: 'en',
			})
			const de = await booted.payload.findByID({
				collection: 'phoneRecords',
				id: created.id,
				locale: 'de',
			})
			expect(en.localizedPhone).toMatchObject({ country: 'DE', number: '+4915112345678' })
			expect(de.localizedPhone).toMatchObject({ country: 'US', number: '+12015550123' })

			const all = await booted.payload.findByID({
				collection: 'phoneRecords',
				id: created.id,
				locale: 'all',
			})
			expect(all.localizedPhone).toMatchObject({
				de: { country: 'US', number: '+12015550123' },
				en: { country: 'DE', number: '+4915112345678' },
			})
		})
	})

	describe('array nesting', () => {
		it('round-trips a phone field nested in an array independently per row', async () => {
			const created = await booted.payload.create({
				collection: 'phoneRecords',
				data: {
					contacts: [
						{ phone: { country: 'DE', number: '+4915112345678' }, role: 'primary' },
						{ phone: { country: 'US', number: '+12015550123' }, role: 'secondary' },
					],
					title: 'array-rows',
				},
			})
			const createdContacts = created.contacts as Array<{ phone: Record<string, unknown> }>
			expect(createdContacts[0]?.phone).toMatchObject({
				country: 'DE',
				international: '+49 1511 2345678',
				number: '+4915112345678',
			})
			expect(createdContacts[1]?.phone).toMatchObject({
				country: 'US',
				international: '+1 201 555 0123',
				number: '+12015550123',
			})

			// Only row 1 changes; row 0 must survive untouched, proving the rows are not
			// cross-scoped through shared sibling data.
			const updated = await booted.payload.update({
				collection: 'phoneRecords',
				data: {
					contacts: [
						{ phone: { country: 'DE', number: '+4915112345678' }, role: 'primary' },
						{ phone: { country: 'US', number: '+12015559999' }, role: 'secondary' },
					],
				},
				id: created.id,
			})
			const updatedContacts = updated.contacts as Array<{ phone: Record<string, unknown> }>
			expect(updatedContacts[0]?.phone).toMatchObject({
				international: '+49 1511 2345678',
				number: '+4915112345678',
			})
			expect(updatedContacts[1]?.phone).toMatchObject({
				international: '+1 201 555 9999',
				number: '+12015559999',
			})
		})
	})
})

describeForDb('phone number field registry defaults', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [registryPhones],
			db,
			plugin: fields({ phoneNumber: { defaultCountry: 'DE', validation: 'mobile' } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it("resolves the registry's defaultCountry and validation when the field sets neither", async () => {
		const doc = await booted.payload.create({
			collection: 'registryPhones',
			data: { inherited: '0151 12345678', title: 'inherit-ok' },
		})
		expect(doc.inherited).toBe('0151 12345678')
	})

	it("rejects via the registry's validation, reachable only through the registry's defaultCountry", async () => {
		// Unparseable without defaultCountry (no leading +) and, once parsed, a landline:
		// only fails this specific way if both registry defaults actually reached checkPhone.
		await expect(
			booted.payload.create({
				collection: 'registryPhones',
				data: { inherited: '030 1234567', title: 'inherit-landline' },
			})
		).rejects.toMatchObject({
			data: {
				errors: expect.arrayContaining([
					expect.objectContaining({ message: 'Enter a mobile phone number.', path: 'inherited' }),
				]),
			},
		})
	})

	it("lets a field's own validation win over the registry default", async () => {
		const doc = await booted.payload.create({
			collection: 'registryPhones',
			data: { pinnedValid: '030 1234567', title: 'override-ok' },
		})
		expect(doc.pinnedValid).toBe('030 1234567')
	})
})
