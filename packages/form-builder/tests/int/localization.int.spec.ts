import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { Block, Field } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

const flatten = (fields: Field[]): Field[] =>
	fields.flatMap((field) => {
		if (field.type === 'tabs') {
			return field.tabs.flatMap((tab) => flatten(tab.fields))
		}
		if ('fields' in field && Array.isArray(field.fields)) {
			return [field, ...flatten(field.fields as Field[])]
		}
		return [field]
	})

const namedField = (fields: Field[], name: string): Field | undefined =>
	flatten(fields).find((field) => 'name' in field && field.name === name)

const blockOf = (fields: Field[], blocksName: string, slug: string): Block | undefined => {
	const blocksField = namedField(fields, blocksName)
	if (blocksField?.type !== 'blocks') {
		return undefined
	}
	return blocksField.blocks.find((block) => block.slug === slug)
}

const isLocalized = (field: Field | undefined): boolean =>
	Boolean(field && 'localized' in field && field.localized === true)

const formsFields = (booted: BootedPayload): Field[] =>
	booted.payload.collections.forms?.config.fields ?? []

const localization = { locales: ['en', 'de'], defaultLocale: 'en' }

describeForDb('form-builder content localization (localized host)', { dbs: ['mongo'] }, (db) => {
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

	it('localizes the form title', () => {
		expect(isLocalized(namedField(formsFields(booted), 'title'))).toBe(true)
	})

	it('requires the title in the default locale but lets other locales fall back', async () => {
		await expect(
			booted.payload.create({ collection: 'forms', data: { fields: [] } })
		).rejects.toThrow()
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Present', fields: [] },
		})
		// A non-default-locale write may omit the title; it falls back to the default-locale value.
		const updated = await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: { fields: [] },
		})
		expect(updated.id).toBe(form.id)
	})

	it('localizes the shared content fields on field blocks', () => {
		const textBlock = blockOf(formsFields(booted), 'fields', 'text')
		expect(textBlock).toBeDefined()
		const fields = textBlock?.fields ?? []
		expect(isLocalized(namedField(fields, 'label'))).toBe(true)
		expect(isLocalized(namedField(fields, 'placeholder'))).toBe(true)
		expect(isLocalized(namedField(fields, 'description'))).toBe(true)
		expect(isLocalized(namedField(fields, 'name'))).toBe(false)
		expect(isLocalized(namedField(fields, 'width'))).toBe(false)
		expect(isLocalized(namedField(fields, 'hidden'))).toBe(false)
	})

	it('localizes select option labels but never values', () => {
		const selectBlock = blockOf(formsFields(booted), 'fields', 'select')
		const options = namedField(selectBlock?.fields ?? [], 'options')
		expect(options?.type).toBe('array')
		const optionFields = options && 'fields' in options ? options.fields : []
		expect(isLocalized(namedField(optionFields, 'label'))).toBe(true)
		expect(isLocalized(namedField(optionFields, 'value'))).toBe(false)
	})

	// Consent carries no localized content of its own: the statement lives on the host's placed
	// `consentSourcesField()`, whose own `localized` option covers it (see its unit tests).

	it('localizes the repeater add label but not the row bounds', () => {
		const repeaterBlock = blockOf(formsFields(booted), 'fields', 'repeater')
		const fields = repeaterBlock?.fields ?? []
		expect(isLocalized(namedField(fields, 'addLabel'))).toBe(true)
		expect(isLocalized(namedField(fields, 'minRows'))).toBe(false)
		expect(isLocalized(namedField(fields, 'maxRows'))).toBe(false)
	})

	it('localizes action subjects, bodies, and the team "to" but not identifiers or secrets', () => {
		const fields = formsFields(booted)
		for (const slug of ['emailTeam', 'confirmation']) {
			const block = blockOf(fields, 'actions', slug)
			expect(isLocalized(namedField(block?.fields ?? [], 'subject'))).toBe(true)
			expect(isLocalized(namedField(block?.fields ?? [], 'body'))).toBe(true)
		}
		// The team `to` is a routing target: localized so each locale keeps its own address and a
		// submission's locale selects the address it routes to. The confirmation `toField` names a
		// form field (an identifier), so it stays non-localized, as do webhook addresses and secrets.
		const emailTeamBlock = blockOf(fields, 'actions', 'emailTeam')
		expect(isLocalized(namedField(emailTeamBlock?.fields ?? [], 'to'))).toBe(true)
		const confirmationBlock = blockOf(fields, 'actions', 'confirmation')
		expect(isLocalized(namedField(confirmationBlock?.fields ?? [], 'toField'))).toBe(false)
		const webhookBlock = blockOf(fields, 'actions', 'signedWebhook')
		expect(isLocalized(namedField(webhookBlock?.fields ?? [], 'url'))).toBe(false)
	})

	it('stores per-locale labels and keeps plain writes working', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				fields: [{ blockType: 'text', name: 'fullName', label: 'Full name' }],
			},
		})
		const rows = form.fields as Array<{ id: string; name: string; label: string }>
		expect(rows[0]?.label).toBe('Full name')

		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: {
				fields: [{ id: rows[0]?.id, blockType: 'text', name: 'fullName', label: 'Voller Name' }],
			},
		})
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: { title: 'Kontakt' },
		})
		const de = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'de' })
		const en = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'en' })
		expect((de.fields as Array<{ label: string }>)[0]?.label).toBe('Voller Name')
		expect((en.fields as Array<{ label: string }>)[0]?.label).toBe('Full name')
		expect(de.title).toBe('Kontakt')
		expect(en.title).toBe('Contact')
	})
})

describeForDb(
	'form-builder content localization (non-localized host)',
	{ dbs: ['mongo'] },
	(db) => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({}), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('payload strips the localized flag when the host has no localization', () => {
			expect(isLocalized(namedField(formsFields(booted), 'title'))).toBe(false)
			const textBlock = blockOf(formsFields(booted), 'fields', 'text')
			const label = namedField(textBlock?.fields ?? [], 'label')
			expect(label).toBeDefined()
			expect(label && 'localized' in label && label.localized).toBeFalsy()
			const emailTeamBlock = blockOf(formsFields(booted), 'actions', 'emailTeam')
			const body = namedField(emailTeamBlock?.fields ?? [], 'body')
			expect(body && 'localized' in body && body.localized).toBeFalsy()
		})

		it('plain-string labels keep working', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Contact',
					fields: [{ blockType: 'text', name: 'fullName', label: 'Full name' }],
				},
			})
			expect((form.fields as Array<{ label: string }>)[0]?.label).toBe('Full name')
		})
	}
)

describeForDb('form-builder content localization (opt-out)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ localizeContent: false }),
			db,
			configOverrides: { localization },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps content single-locale on a localized host when localizeContent is false', () => {
		const fields = formsFields(booted)
		const textBlock = blockOf(fields, 'fields', 'text')
		const label = namedField(textBlock?.fields ?? [], 'label')
		expect(label).toBeDefined()
		expect(label && 'localized' in label && label.localized).toBeFalsy()
		const selectBlock = blockOf(fields, 'fields', 'select')
		const options = namedField(selectBlock?.fields ?? [], 'options')
		const optionFields = options && 'fields' in options ? options.fields : []
		const optionLabel = namedField(optionFields, 'label')
		expect(optionLabel && 'localized' in optionLabel && optionLabel.localized).toBeFalsy()
		const emailTeamBlock = blockOf(fields, 'actions', 'emailTeam')
		const body = namedField(emailTeamBlock?.fields ?? [], 'body')
		expect(body && 'localized' in body && body.localized).toBeFalsy()
	})
})
