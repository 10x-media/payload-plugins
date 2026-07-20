import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { ArrayField, Field, GlobalConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { departmentsField } from '../../src/email/departmentsField'
import { formBuilder } from '../../src/index'

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

// Fresh per boot: Payload's sanitizeConfig mutates field configs in place (it deletes `localized`
// on hosts without localization), so a shared global object would leak that mutation between boots.
const makeSettings = (): GlobalConfig => ({
	slug: 'settings',
	fields: [departmentsField() as Field],
})

const isLocalized = (field: Field | undefined): boolean =>
	Boolean(field && 'localized' in field && field.localized === true)

const departmentArray = (booted: BootedPayload): ArrayField | undefined => {
	const field = booted.payload.config.globals
		.find((global) => global.slug === 'settings')
		?.fields.find((f) => 'name' in f && f.name === 'departmentEmails')
	return field?.type === 'array' ? field : undefined
}

const subfield = (array: ArrayField | undefined, name: string): Field | undefined =>
	array?.fields.find((f) => 'name' in f && f.name === name)

type DeptRow = { id: string; label?: string | null; email?: string | null }
const rowsOf = (doc: unknown): DeptRow[] =>
	(doc as { departmentEmails?: DeptRow[] }).departmentEmails ?? []

describeForDb('form-builder department emails (localized host)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({}),
			db,
			configOverrides: { globals: [makeSettings()], localization },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('boots through sanitizeConfig with the array and its label and email subfields intact', () => {
		const array = departmentArray(booted)
		expect(array?.type).toBe('array')
		const names = array?.fields.flatMap((f) => ('name' in f ? [f.name] : [])) ?? []
		// Payload appends its own auto `id` row field during sanitize; the authored pair is label + email.
		expect(names).toContain('label')
		expect(names).toContain('email')
	})

	it('carries the localized flag on both subfields, so email can hold a different value per locale', () => {
		const array = departmentArray(booted)
		expect(isLocalized(subfield(array, 'label'))).toBe(true)
		expect(isLocalized(subfield(array, 'email'))).toBe(true)
	})

	it('stores a different email per locale for the same row, addressed by its own id', async () => {
		await booted.payload.updateGlobal({
			slug: 'settings',
			data: { departmentEmails: [{ label: 'Sales', email: 'sales@example.com' }] },
		})
		const seeded = await booted.payload.findGlobal({ slug: 'settings', depth: 0 })
		const rowId = rowsOf(seeded)[0]?.id
		expect(rowId).toBeDefined()

		await booted.payload.updateGlobal({
			slug: 'settings',
			locale: 'de',
			data: { departmentEmails: [{ id: rowId, label: 'Vertrieb', email: 'vertrieb@example.de' }] },
		})

		const en = await booted.payload.findGlobal({ slug: 'settings', locale: 'en', depth: 0 })
		const de = await booted.payload.findGlobal({ slug: 'settings', locale: 'de', depth: 0 })
		expect(rowsOf(en)[0]?.email).toBe('sales@example.com')
		expect(rowsOf(de)[0]?.email).toBe('vertrieb@example.de')
	})
})

describeForDb('form-builder department emails (non-localized host)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({}),
			db,
			configOverrides: { globals: [makeSettings()] },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('strips the localized flag when the host config has no localization', () => {
		const array = departmentArray(booted)
		expect(isLocalized(subfield(array, 'label'))).toBe(false)
		expect(isLocalized(subfield(array, 'email'))).toBe(false)
	})
})
