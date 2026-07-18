import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { departmentsField } from './departmentsField'

const fieldNamed = (fields: Field[], name: string) =>
	fields.find((field) => 'name' in field && field.name === name)

const CONDENSED_ARRAY_REF = '@10x-media/form-builder/client#CondensedArray'

describe('departmentsField', () => {
	it('is an array named departmentEmails by default', () => {
		const field = departmentsField()
		expect(field.type).toBe('array')
		expect(field.name).toBe('departmentEmails')
	})

	it('takes a host-supplied name and label', () => {
		const field = departmentsField({ name: 'teamInboxes', label: 'Team inboxes' })
		expect(field.name).toBe('teamInboxes')
		expect(field.label).toBe('Team inboxes')
	})

	it('rows are exactly label and email, with no author-facing key field', () => {
		expect(departmentsField().fields.map((f) => ('name' in f ? f.name : f.type))).toEqual([
			'label',
			'email',
		])
	})

	it('renders through the condensed custom Field so rows spawn flat instead of collapsibles', () => {
		expect(departmentsField().admin?.components?.Field).toBe(CONDENSED_ARRAY_REF)
	})

	it('localizes both label and email by default, and neither when opted out', () => {
		const localized = departmentsField().fields
		const plain = departmentsField({ localized: false }).fields
		for (const name of ['label', 'email']) {
			expect((fieldNamed(localized, name) as { localized?: boolean }).localized).toBe(true)
			expect('localized' in (fieldNamed(plain, name) ?? {})).toBe(false)
		}
	})

	it('lays each subfield out at half width so a row reads as [label, email]', () => {
		const fields = departmentsField().fields
		for (const name of ['label', 'email']) {
			expect((fieldNamed(fields, name) as { admin?: { width?: string } }).admin?.width).toBe('50%')
		}
	})
})
