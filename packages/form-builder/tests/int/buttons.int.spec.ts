import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { toFormDocument } from '../../src/form/toFormDocument'
import { formBuilder } from '../../src/index'

const buttonsGroupOf = (booted: BootedPayload): Extract<Field, { type: 'group' }> | undefined => {
	const fields = booted.payload.collections.forms?.config.fields ?? []
	const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
	return tabs?.tabs
		.flatMap((tab) => ('fields' in tab ? tab.fields : []))
		.find(
			(f): f is Extract<Field, { type: 'group' }> =>
				f.type === 'group' && 'name' in f && f.name === 'buttons'
		)
}

const isLocalized = (field: Field | undefined): boolean =>
	Boolean(field && 'localized' in field && field.localized === true)

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

describeForDb('form-builder buttons group (localized host)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({}),
			db,
			configOverrides: { localization },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('localizes all three button label fields', () => {
		const group = buttonsGroupOf(booted)
		expect(group).toBeDefined()
		for (const name of ['submitLabel', 'nextLabel', 'backLabel']) {
			const field = group?.fields.find((f) => 'name' in f && f.name === name)
			expect(isLocalized(field)).toBe(true)
		}
	})

	it('round-trips per-locale button labels', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Buttons',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				buttons: { submitLabel: 'Send', nextLabel: 'Continue', backLabel: 'Previous' },
			},
		})
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: {
				buttons: { submitLabel: 'Abschicken', nextLabel: 'Weiter', backLabel: 'Zurück' },
			},
		})
		const de = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'de' })
		const en = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'en' })
		expect(de.buttons).toMatchObject({
			submitLabel: 'Abschicken',
			nextLabel: 'Weiter',
			backLabel: 'Zurück',
		})
		expect(en.buttons).toMatchObject({
			submitLabel: 'Send',
			nextLabel: 'Continue',
			backLabel: 'Previous',
		})
	})
})

// Empty options: Mongo by default, both DBs under the matrix tier, proving the composed group
// (row + host select) sanitizes, stores, and reads back identically cross-DB.
describeForDb('form-builder buttons seam (host-extended group)', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				buttons: {
					fields: ({ defaultFields }) => [
						{
							type: 'row',
							fields: [
								defaultFields.submit,
								{
									name: 'submitIcon',
									type: 'select',
									options: [
										{ label: 'Arrow right', value: 'arrow-right' },
										{ label: 'Paper plane', value: 'paper-plane' },
									],
								},
							],
						},
						defaultFields.next,
						defaultFields.back,
					],
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('boots with the composed group: row wrapping submit + icon, then next and back', () => {
		const group = buttonsGroupOf(booted)
		expect(group?.fields).toHaveLength(3)
		const [row, next, back] = group?.fields ?? []
		expect(row?.type).toBe('row')
		const rowNames = (row && 'fields' in row ? row.fields : []).map((f) =>
			'name' in f ? f.name : undefined
		)
		expect(rowNames).toEqual(['submitLabel', 'submitIcon'])
		expect(next).toMatchObject({ name: 'nextLabel' })
		expect(back).toMatchObject({ name: 'backLabel' })
	})

	it('persists the host-added field and hands it to the client via toFormDocument', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Iconed submit',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				buttons: { submitLabel: 'Send', submitIcon: 'arrow-right' },
			},
		})
		const stored = form.buttons as { submitLabel?: string; submitIcon?: string }
		expect(stored.submitLabel).toBe('Send')
		expect(stored.submitIcon).toBe('arrow-right')

		const doc = toFormDocument(form as Parameters<typeof toFormDocument>[0])
		expect(doc.buttons?.submitLabel).toBe('Send')
		expect(doc.buttons?.submitIcon).toBe('arrow-right')
	})
})
