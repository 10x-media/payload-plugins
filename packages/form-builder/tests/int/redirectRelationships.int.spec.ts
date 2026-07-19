import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Field } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toFormDocument } from '../../src/form/toFormDocument'
import { formBuilder } from '../../src/index'

const pages: CollectionConfig = {
	slug: 'pages',
	fields: [{ name: 'title', type: 'text' }],
}

/** The `redirect` group's fields off the forms collection's `response` group. */
const redirectFieldsOf = (booted: BootedPayload) => {
	const formsCollection = booted.payload.collections.forms
	const tabs = formsCollection?.config.fields.find((field) => field.type === 'tabs')
	const tabFields = tabs?.type === 'tabs' ? tabs.tabs.flatMap((tab) => tab.fields) : []
	const response = tabFields.find((field) => 'name' in field && field.name === 'response')
	const redirect =
		response?.type === 'group'
			? response.fields.find((field) => 'name' in field && field.name === 'redirect')
			: undefined
	return redirect?.type === 'group' ? redirect.fields : []
}

describeForDb('form-builder redirectRelationships', { dbs: ['mongo'] }, (db) => {
	describe('with the option set', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({
				plugin: formBuilder({ redirectRelationships: ['pages'] }),
				db,
				collections: [pages],
			})
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('registers a polymorphic reference relationship field on response.redirect', () => {
			const fields = redirectFieldsOf(booted)
			const reference = fields.find((field) => 'name' in field && field.name === 'reference') as
				| Extract<Field, { type: 'relationship' }>
				| undefined
			expect(reference?.type).toBe('relationship')
			expect(reference?.relationTo).toEqual(['pages'])
			expect(fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
		})

		it('persists response.redirect.reference and surfaces it through toFormDocument', async () => {
			const page = await booted.payload.create({ collection: 'pages', data: { title: 'Thanks' } })

			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'Redirect form',
					fields: [],
					response: {
						type: 'redirect',
						redirect: { reference: { relationTo: 'pages', value: page.id } },
					},
				},
				depth: 0,
			})

			const stored = form as unknown as {
				response?: { redirect?: { reference?: { relationTo?: string; value?: unknown } } }
			}
			expect(stored.response?.redirect?.reference).toMatchObject({
				relationTo: 'pages',
				value: page.id,
			})

			const fetched = await booted.payload.findByID({
				collection: 'forms',
				id: form.id,
				depth: 0,
			})
			const doc = toFormDocument(fetched as never)
			expect(doc.response?.redirect?.reference).toEqual({ relationTo: 'pages', value: page.id })
		})

		it('leaves the reference unset when the author never picks one', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'URL-only redirect',
					fields: [],
					response: { type: 'redirect', redirect: { url: 'https://example.com' } },
				},
			})

			const fetched = await booted.payload.findByID({
				collection: 'forms',
				id: form.id,
				depth: 0,
			})
			const doc = toFormDocument(fetched as never)
			expect(doc.response?.redirect?.url).toBe('https://example.com')
			expect(doc.response?.redirect?.reference).toBeFalsy()
		})
	})

	describe('with the option absent', () => {
		let booted: BootedPayload

		beforeAll(async () => {
			booted = await bootPayload({ plugin: formBuilder({}), db })
		})

		afterAll(async () => {
			await booted.stop()
		})

		it('has no reference field on response.redirect', () => {
			const fields = redirectFieldsOf(booted)
			expect(fields.some((field) => 'name' in field && field.name === 'reference')).toBe(false)
			expect(fields.some((field) => 'name' in field && field.name === 'url')).toBe(true)
		})

		it('still accepts a URL-only redirect', async () => {
			const form = await booted.payload.create({
				collection: 'forms',
				data: {
					title: 'No redirectRelationships',
					fields: [],
					response: { type: 'redirect', redirect: { url: 'https://example.com' } },
				},
			})
			expect(form.id).toBeDefined()
		})
	})
})
