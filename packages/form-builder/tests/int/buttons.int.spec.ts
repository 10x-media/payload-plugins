import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { toFormDocument } from '../../src/form/toFormDocument'
import { formBuilder } from '../../src/index'

const formsFieldsOf = (booted: BootedPayload): Field[] =>
	booted.payload.collections.forms?.config.fields ?? []

const tabWith = (fields: Field[], fieldName: string) => {
	const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
	return tabs?.tabs.find(
		(tab) => 'fields' in tab && tab.fields.some((f) => 'name' in f && f.name === fieldName)
	)
}

const flatten = (field: Field | undefined): Field[] =>
	field && 'fields' in field && Array.isArray(field.fields) ? field.fields : field ? [field] : []

// The three button labels no longer live in a group: `submit` (or its host-wrapping row) sits at the
// bottom of the Fields tab, and prev/next in a row on the Flow tab. Flatten both to a single list.
const buttonFieldsOf = (booted: BootedPayload): Field[] => {
	const fields = formsFieldsOf(booted)
	return [
		...flatten(tabWith(fields, 'fields')?.fields.at(-1)),
		...flatten(tabWith(fields, 'flow')?.fields.at(-1)),
	]
}

const isLocalized = (field: Field | undefined): boolean =>
	Boolean(field && 'localized' in field && field.localized === true)

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

describeForDb('form-builder button labels (localized host)', { dbs: ['mongo'] }, (db) => {
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
		const fields = buttonFieldsOf(booted)
		for (const name of ['submitLabel', 'nextLabel', 'prevLabel']) {
			const field = fields.find((f) => 'name' in f && f.name === name)
			expect(isLocalized(field)).toBe(true)
		}
	})

	it('round-trips per-locale button labels', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Buttons',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				submitLabel: 'Send',
				nextLabel: 'Continue',
				prevLabel: 'Previous',
			},
		})
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: { submitLabel: 'Abschicken', nextLabel: 'Weiter', prevLabel: 'Zurück' },
		})
		const de = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'de' })
		const en = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'en' })
		expect(de).toMatchObject({
			submitLabel: 'Abschicken',
			nextLabel: 'Weiter',
			prevLabel: 'Zurück',
		})
		expect(en).toMatchObject({ submitLabel: 'Send', nextLabel: 'Continue', prevLabel: 'Previous' })
	})
})

// Empty options: Mongo by default, both DBs under the matrix tier, proving the composed submit slot
// (row + host select) sanitizes, stores, and reads back identically cross-DB.
describeForDb('form-builder buttons seam (host-extended submit)', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				buttons: {
					fields: ({ defaultFields }) => ({
						submit: {
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
						next: defaultFields.next,
						prev: defaultFields.prev,
					}),
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('boots with the composed submit slot on Fields and prev/next on Flow', () => {
		const fields = formsFieldsOf(booted)
		const submit = tabWith(fields, 'fields')?.fields.at(-1)
		expect(submit?.type).toBe('row')
		const submitNames = (submit && 'fields' in submit ? submit.fields : []).map((f) =>
			'name' in f ? f.name : undefined
		)
		expect(submitNames).toEqual(['submitLabel', 'submitIcon'])
		const row = tabWith(fields, 'flow')?.fields.at(-1)
		const rowNames = (row && 'fields' in row ? row.fields : []).map((f) =>
			'name' in f ? f.name : undefined
		)
		expect(rowNames).toEqual(['prevLabel', 'nextLabel'])
	})

	it('persists the host-added field at the top level; toFormDocument forwards only the labels', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Iconed submit',
				fields: [{ blockType: 'text', name: 'name', label: 'Name' }],
				submitLabel: 'Send',
				submitIcon: 'arrow-right',
			},
		})
		const stored = form as { submitLabel?: string; submitIcon?: string }
		expect(stored.submitLabel).toBe('Send')
		expect(stored.submitIcon).toBe('arrow-right')

		const doc = toFormDocument(form as Parameters<typeof toFormDocument>[0])
		expect(doc.buttons?.submitLabel).toBe('Send')
		// The host-added top-level field is not auto-forwarded onto FormDocument.buttons (allowlist).
		expect(doc.buttons?.submitIcon).toBeUndefined()
	})
})
