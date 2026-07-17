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

const fieldsTabOf = (fields: Field[]) => {
	const tabs = fields.find((f): f is Extract<Field, { type: 'tabs' }> => f.type === 'tabs')
	return tabs?.tabs.find(
		(tab) => 'fields' in tab && tab.fields.some((f) => 'name' in f && f.name === 'fields')
	)
}

const buttonsGroupOf = (fields: Field[]) =>
	fieldsTabOf(fields)?.fields.find(
		(f): f is Extract<Field, { type: 'group' }> =>
			f.type === 'group' && 'name' in f && f.name === 'buttons'
	)

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

describe('forms buttons group', () => {
	it('sits at the bottom of the Fields tab: submit full width, then a prev/next row', async () => {
		const fields = await formsFieldsOf({})
		const tab = fieldsTabOf(fields)
		expect(tab?.fields.at(-1)).toMatchObject({ type: 'group', name: 'buttons' })
		const group = buttonsGroupOf(fields)
		expect(group?.fields).toHaveLength(2)
		const [submit, row] = group?.fields ?? []
		expect(submit).toMatchObject({ name: 'submitLabel' })
		expect(row).toMatchObject({ type: 'row' })
		const rowFields = row && 'fields' in row ? row.fields : []
		expect(namesOf(rowFields)).toEqual(['prevLabel', 'nextLabel'])
		expect(rowFields[0]).toMatchObject({ name: 'prevLabel', admin: { width: '50%' } })
		expect(rowFields[1]).toMatchObject({ name: 'nextLabel', admin: { width: '50%' } })
	})

	it('keeps the multi-step description on prev/next after the width merge', async () => {
		const fields = await formsFieldsOf({})
		const group = buttonsGroupOf(fields)
		const [, row] = group?.fields ?? []
		const rowFields = (row && 'fields' in row ? row.fields : []) as FieldWithAdmin[]
		for (const field of rowFields) {
			expect(typeof field.admin?.description).toBe('function')
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

	it('uses the buttons.fields return verbatim', async () => {
		const fields = await formsFieldsOf({
			buttons: {
				fields: ({ defaultFields }) => [
					{
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
					defaultFields.prev,
				],
			},
		})
		const group = buttonsGroupOf(fields)
		expect(group?.fields).toHaveLength(2)
		const [row, prev] = group?.fields ?? []
		expect(row).toMatchObject({ type: 'row' })
		expect(namesOf(row && 'fields' in row ? row.fields : [])).toEqual(['submitLabel', 'submitIcon'])
		expect(prev).toMatchObject({ name: 'prevLabel' })
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
						return [defaultFields.submit, defaultFields.next, defaultFields.prev]
					},
				},
			})
		await record({})
		await record({ localizeContent: false })
		expect(seen).toEqual([true, true, true, false, false, false])
	})
})
