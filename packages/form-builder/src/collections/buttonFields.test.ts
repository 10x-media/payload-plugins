import type { Config, Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { formBuilder } from '../index'
import {
	buildDefaultButtonFields,
	buildNextLabelField,
	buildPrevLabelField,
	buildSubmitLabelField,
} from './buttonFields'

const formsFieldsOf = async (options: Parameters<typeof formBuilder>[0]): Promise<Field[]> => {
	const plugin = formBuilder(options)
	const config = { collections: [] } as unknown as Config
	const out = await Promise.resolve(plugin(config))
	return out.collections?.find((c) => c.slug === 'forms')?.fields ?? []
}

const tabWith = (fields: Field[], fieldName: string) => {
	const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
	return tabs?.tabs.find(
		(tab) => 'fields' in tab && tab.fields.some((f) => 'name' in f && f.name === fieldName)
	)
}

const fieldsTabOf = (fields: Field[]) => tabWith(fields, 'fields')
const flowTabOf = (fields: Field[]) => tabWith(fields, 'flow')

const namesOf = (fields: Field[] | undefined): (string | undefined)[] =>
	(fields ?? []).map((f) => ('name' in f ? f.name : undefined))

const isLocalized = (field: Field | undefined): boolean =>
	Boolean(field && 'localized' in field && field.localized === true)

type FieldWithAdmin = { name?: string; admin?: { description?: unknown; width?: string } }

describe('default button label fields', () => {
	it('builds localized text fields named submitLabel/prevLabel/nextLabel', () => {
		expect(buildSubmitLabelField(true)).toMatchObject({
			name: 'submitLabel',
			type: 'text',
			localized: true,
		})
		expect(buildPrevLabelField(true)).toMatchObject({
			name: 'prevLabel',
			type: 'text',
			localized: true,
		})
		expect(buildNextLabelField(true)).toMatchObject({
			name: 'nextLabel',
			type: 'text',
			localized: true,
		})
	})

	it('omits the localized flag when localize is false', () => {
		for (const field of Object.values(buildDefaultButtonFields(false))) {
			expect('localized' in field).toBe(false)
		}
	})
})

describe('forms buttons fields', () => {
	it('places submit at the bottom of the Fields tab and prev/next in a row on the Flow tab', async () => {
		const fields = await formsFieldsOf({})
		expect(fieldsTabOf(fields)?.fields.at(-1)).toMatchObject({ name: 'submitLabel' })
		const row = flowTabOf(fields)?.fields.at(-1)
		expect(row).toMatchObject({ type: 'row' })
		const rowFields = row && 'fields' in row ? row.fields : []
		expect(namesOf(rowFields)).toEqual(['prevLabel', 'nextLabel'])
		expect(rowFields[0]).toMatchObject({ name: 'prevLabel', admin: { width: '50%' } })
		expect(rowFields[1]).toMatchObject({ name: 'nextLabel', admin: { width: '50%' } })
	})

	it('gives prev/next the half-width admin and no leftover description', async () => {
		const fields = await formsFieldsOf({})
		const row = flowTabOf(fields)?.fields.at(-1)
		const rowFields = (row && 'fields' in row ? row.fields : []) as FieldWithAdmin[]
		for (const field of rowFields) {
			expect(field.admin?.width).toBe('50%')
			expect(field.admin?.description).toBeUndefined()
		}
	})

	it('no longer carries a submitLabel in the response group', async () => {
		const fields = await formsFieldsOf({})
		const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
		const response = tabs?.tabs
			.flatMap((tab) => ('fields' in tab ? tab.fields : []))
			.find(
				(f): f is Extract<Field, { type: 'group' }> =>
					f.type === 'group' && 'name' in f && f.name === 'response'
			)
		expect(response).toBeDefined()
		expect(namesOf(response?.fields)).not.toContain('submitLabel')
	})

	it('places each slot the buttons.fields map returns', async () => {
		const fields = await formsFieldsOf({
			buttons: {
				fields: ({ defaultFields }) => ({
					submit: {
						type: 'row',
						fields: [
							defaultFields.submit,
							{
								name: 'submitIcon',
								type: 'select',
								options: [{ label: 'Arrow right', value: 'arrow-right' }],
							},
						],
					},
					prev: defaultFields.prev,
					next: defaultFields.next,
				}),
			},
		})
		const submit = fieldsTabOf(fields)?.fields.at(-1)
		expect(submit).toMatchObject({ type: 'row' })
		expect(namesOf(submit && 'fields' in submit ? submit.fields : [])).toEqual([
			'submitLabel',
			'submitIcon',
		])
		const row = flowTabOf(fields)?.fields.at(-1)
		expect(namesOf(row && 'fields' in row ? row.fields : [])).toEqual(['prevLabel', 'nextLabel'])
	})

	it('hands the seam already-localized defaults, following localizeContent', async () => {
		const seen: boolean[] = []
		const record = (options: Parameters<typeof formBuilder>[0]) =>
			formsFieldsOf({
				...options,
				buttons: {
					fields: ({ defaultFields }) => {
						seen.push(
							isLocalized(defaultFields.submit),
							isLocalized(defaultFields.next),
							isLocalized(defaultFields.prev)
						)
						return defaultFields
					},
				},
			})
		await record({})
		await record({ localizeContent: false })
		expect(seen).toEqual([true, true, true, false, false, false])
	})
})
