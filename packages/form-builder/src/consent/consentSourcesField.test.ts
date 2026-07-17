import type { Field, RelationshipField, RichTextField } from 'payload'
import { describe, expect, it } from 'vitest'
import { consentSourcesField } from './consentSourcesField'

const fieldNamed = (fields: Field[], name: string) =>
	fields.find((field) => 'name' in field && field.name === name)

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

	it('rows are key, label, and statement, with no version or URL to fill in', () => {
		expect(consentSourcesField().fields.map((f) => ('name' in f ? f.name : f.type))).toEqual([
			'key',
			'label',
			'statement',
		])
	})

	it('requires the key and guards its uniqueness across rows', () => {
		const key = fieldNamed(consentSourcesField().fields, 'key') as {
			required?: boolean
			validate?: unknown
		}
		expect(key.required).toBe(true)
		expect(typeof key.validate).toBe('function')
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

	it('localizes the statement and label by default, and not when opted out', () => {
		const localized = consentSourcesField().fields
		const plain = consentSourcesField({ localized: false }).fields
		for (const name of ['statement', 'label']) {
			expect((fieldNamed(localized, name) as { localized?: boolean }).localized).toBe(true)
			expect('localized' in (fieldNamed(plain, name) ?? {})).toBe(false)
		}
	})

	it('never localizes the key, which is an identifier', () => {
		expect('localized' in (fieldNamed(consentSourcesField().fields, 'key') ?? {})).toBe(false)
	})

	it('leaves the statement editor to the project unless one is given', () => {
		const statement = fieldNamed(consentSourcesField().fields, 'statement') as RichTextField
		expect('editor' in statement).toBe(false)
		const editor = { fake: 'editor' } as unknown as RichTextField['editor']
		expect(
			(fieldNamed(consentSourcesField({ editor }).fields, 'statement') as RichTextField).editor
		).toBe(editor)
	})
})
