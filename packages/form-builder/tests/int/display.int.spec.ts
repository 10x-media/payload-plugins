import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

const lexical = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

describeForDb('form-builder display settings', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({}), db })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('defaults showTitle to false when omitted', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Contact' },
		})
		const display = form.display as { showTitle?: boolean } | undefined
		expect(display?.showTitle).toBe(false)
	})

	it('round-trips showTitle, title, and rich text intro', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Contact',
				display: {
					showTitle: true,
					title: 'Get in touch',
					intro: lexical('We usually reply fast.'),
				},
			},
		})
		const display = form.display as { showTitle?: boolean; title?: string; intro?: unknown }
		expect(display.showTitle).toBe(true)
		expect(display.title).toBe('Get in touch')
		expect(display.intro).toMatchObject(lexical('We usually reply fast.'))
	})
})

describeForDb('form-builder display settings (localized host)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({}),
			db,
			configOverrides: { localization: { locales: ['en', 'de'], defaultLocale: 'en' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores a per-locale display title', async () => {
		const form = await booted.payload.create({
			collection: 'forms',
			data: { title: 'Contact', display: { showTitle: true, title: 'Get in touch' } },
		})
		await booted.payload.update({
			collection: 'forms',
			id: form.id,
			locale: 'de',
			data: { display: { showTitle: true, title: 'Kontaktiere uns' } },
		})
		const de = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'de' })
		const en = await booted.payload.findByID({ collection: 'forms', id: form.id, locale: 'en' })
		expect((de.display as { title?: string })?.title).toBe('Kontaktiere uns')
		expect((en.display as { title?: string })?.title).toBe('Get in touch')
	})
})

describeForDb('form-builder display settings (opt-out)', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ localizeContent: false }),
			db,
			configOverrides: { localization: { locales: ['en', 'de'], defaultLocale: 'en' } },
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps the display title single-locale when localizeContent is false', () => {
		const fields = booted.payload.collections.forms?.config.fields ?? []
		const tabsField = fields.find((field) => field.type === 'tabs')
		const displayTab =
			tabsField && 'tabs' in tabsField
				? tabsField.tabs.find((tab) => tab.fields.some((f) => 'name' in f && f.name === 'display'))
				: undefined
		const displayGroup = displayTab?.fields.find((f) => 'name' in f && f.name === 'display')
		const titleField =
			displayGroup && 'fields' in displayGroup
				? displayGroup.fields.find((f) => 'name' in f && f.name === 'title')
				: undefined
		expect(titleField && 'localized' in titleField && titleField.localized).toBeFalsy()
	})
})
