import type { Field, RelationshipField, RichTextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { consentSourcesField } from './consentSourcesField'

const fieldNamed = (fields: Field[], name: string) =>
	fields.find((field) => 'name' in field && field.name === name)

const adminDescription = (field: Field | undefined): unknown =>
	(field as { admin?: { description?: unknown } } | undefined)?.admin?.description

describe('consentSourcesField', () => {
	it('is an array named consentSources by default', () => {
		const field = consentSourcesField()
		expect(field.type).toBe('array')
		expect(field.name).toBe('consentSources')
	})

	it('takes a host-supplied name and label', () => {
		const field = consentSourcesField({ name: 'policies', label: 'Policies' })
		expect(field.name).toBe('policies')
		expect(field.label).toBe('Policies')
	})

	it('rows carry a noticeStatement rich text beside the statement, localized alike', () => {
		const field = consentSourcesField()
		const notice = field.fields.find(
			(entry) => 'name' in entry && entry.name === 'noticeStatement'
		) as { type?: string; localized?: boolean } | undefined
		expect(notice?.type).toBe('richText')
		expect(notice?.localized).toBe(true)
		const optedOut = consentSourcesField({ localized: false }).fields.find(
			(entry) => 'name' in entry && entry.name === 'noticeStatement'
		) as { localized?: boolean } | undefined
		expect(optedOut?.localized).toBeUndefined()
	})

	it('rows are name and the two statements, identified by their own auto-assigned id', () => {
		expect(consentSourcesField().fields.map((f) => ('name' in f ? f.name : f.type))).toEqual([
			'name',
			'statement',
			'noticeStatement',
		])
	})

	it('adds the page picker only when the host names collections for it', () => {
		const page = fieldNamed(
			consentSourcesField({ relationTo: ['pages', 'notices'] }).fields,
			'page'
		) as RelationshipField
		expect(page.type).toBe('relationship')
		expect(page.relationTo).toEqual(['pages', 'notices'])
		expect(fieldNamed(consentSourcesField().fields, 'page')).toBeUndefined()
	})

	it('treats an empty relationTo array as no page picker, not a relationship pointing at nothing', () => {
		expect(fieldNamed(consentSourcesField({ relationTo: [] }).fields, 'page')).toBeUndefined()
	})

	it('keeps a single relationTo polymorphic, so a proof always records the collection too', () => {
		const page = fieldNamed(
			consentSourcesField({ relationTo: 'pages' }).fields,
			'page'
		) as RelationshipField
		expect(page.relationTo).toEqual(['pages'])
	})

	it('localizes the statement and name by default, and not when opted out', () => {
		const localized = consentSourcesField().fields
		const plain = consentSourcesField({ localized: false }).fields
		for (const name of ['statement', 'name']) {
			expect((fieldNamed(localized, name) as { localized?: boolean }).localized).toBe(true)
			expect('localized' in (fieldNamed(plain, name) ?? {})).toBe(false)
		}
	})

	it('leaves the statement editor to the project unless one is given', () => {
		const statement = fieldNamed(consentSourcesField().fields, 'statement') as RichTextField
		expect('editor' in statement).toBe(false)
		const editor = { fake: 'editor' } as unknown as RichTextField['editor']
		expect(
			(fieldNamed(consentSourcesField({ editor }).fields, 'statement') as RichTextField).editor
		).toBe(editor)
	})

	it('drops admin descriptions from name and statement, keeping the array and page ones', () => {
		const field = consentSourcesField({ relationTo: 'pages' })
		expect(adminDescription(fieldNamed(field.fields, 'name'))).toBeUndefined()
		expect(adminDescription(fieldNamed(field.fields, 'statement'))).toBeUndefined()
		expect(adminDescription(fieldNamed(field.fields, 'page'))).toBeDefined()
		expect(field.admin?.description).toBeDefined()
	})
})
