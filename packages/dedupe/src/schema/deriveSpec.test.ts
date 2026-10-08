import type { Field, FlattenedField } from 'payload'
import { describe, expect, it } from 'vitest'

import { deriveSpec, fullLabel, labelPrefixes, resolveSpec } from './deriveSpec'
import { dedupeCustom } from './fieldConfig'

const fields: FlattenedField[] = [
	{ name: 'id', type: 'text' },
	{ name: 'name', type: 'text', localized: true, required: true },
	{ name: 'email', type: 'email', unique: true },
	{ name: 'tags', type: 'text', hasMany: true },
	{ name: 'vip', type: 'checkbox' },
	{ name: 'notes', type: 'textarea', admin: { custom: dedupeCustom({ policy: 'union' }) } },
	{ name: 'secret', type: 'text', hidden: true },
	{ name: 'internal', type: 'text', admin: { hidden: true } },
	{ name: 'company', type: 'relationship', relationTo: 'companies' },
	{
		name: 'profile',
		type: 'group',
		fields: [],
		flattenedFields: [
			{ name: 'bio', type: 'textarea', localized: true },
			{ name: 'score', type: 'number' },
		],
	},
	{
		name: 'i18n',
		type: 'group',
		localized: true,
		fields: [],
		flattenedFields: [{ name: 'title', type: 'text' }],
	},
	{
		name: 'extra',
		type: 'tab',
		fields: [],
		flattenedFields: [{ name: 'code', type: 'text' }],
	},
	{
		name: 'addresses',
		type: 'array',
		fields: [],
		flattenedFields: [{ name: 'city', type: 'text' }],
	},
	{ name: 'full', type: 'text', virtual: true },
	{ name: 'orders', type: 'join', collection: 'orders', on: 'customer' } as FlattenedField,
	{ name: 'createdAt', type: 'date' },
	{ name: 'password', type: 'text' },
	{ name: 'hash', type: 'text' },
]

describe('deriveSpec', () => {
	it("merges a host field named like Payload's folder field where the collection has no folders", () => {
		const host = deriveSpec({ flattenedFields: [{ name: 'folder', type: 'text' }] })
		expect(host.map((entry) => entry.path)).toEqual(['folder'])
		const foldered = deriveSpec(
			{
				flattenedFields: [{ name: 'dir', type: 'relationship', relationTo: 'payload-folders' }],
				folders: {},
			},
			'dir'
		)
		expect(foldered).toEqual([])
	})

	it('refuses a merge policy set where the merge never reads it', () => {
		const group: FlattenedField = {
			name: 'meta',
			type: 'group',
			fields: [],
			admin: { custom: dedupeCustom({ policy: 'union' }) },
			flattenedFields: [{ name: 'code', type: 'text' }],
		}
		expect(() => deriveSpec({ flattenedFields: [group] })).toThrow(/"meta".*policy/)
		const rows: FlattenedField = {
			name: 'rows',
			type: 'array',
			fields: [],
			flattenedFields: [
				{ name: 'note', type: 'text', admin: { custom: dedupeCustom({ policy: 'union' }) } },
			],
		}
		expect(() => deriveSpec({ flattenedFields: [rows] })).toThrow(/"rows.note".*policy/)
		const shared: FlattenedField = {
			name: 'body',
			type: 'blocks',
			blocks: [],
			blockReferences: ['quote'],
		}
		const known = [
			{
				slug: 'quote',
				fields: [],
				flattenedFields: [
					{ name: 'by', type: 'text', admin: { custom: dedupeCustom({ policy: 'union' }) } },
				],
			},
		] as never
		expect(() => deriveSpec({ flattenedFields: [shared] }, 'folder', known)).toThrow(
			/"body.by".*policy/
		)
		const hidden: FlattenedField = {
			name: 'ref',
			type: 'text',
			hidden: true,
			admin: { custom: dedupeCustom({ policy: 'union' }) },
		}
		expect(() => deriveSpec({ flattenedFields: [hidden] })).toThrow(/"ref".*policy/)
	})

	const spec = deriveSpec({ flattenedFields: fields })
	const byPath = new Map(spec.map((entry) => [entry.path, entry]))

	it('skips system, virtual and join fields', () => {
		expect(byPath.has('id')).toBe(false)
		expect(byPath.has('createdAt')).toBe(false)
		expect(byPath.has('full')).toBe(false)
		expect(byPath.has('orders')).toBe(false)
	})

	it('prefixes named groups and tabs', () => {
		expect(byPath.get('profile.bio')).toMatchObject({ localized: true, type: 'textarea' })
		expect(byPath.get('profile.score')).toMatchObject({ type: 'number' })
		expect(byPath.get('extra.code')).toMatchObject({ type: 'text' })
	})

	it('keeps a localized group as one localized value', () => {
		expect(byPath.get('i18n')).toMatchObject({ localized: true, type: 'group' })
		expect(byPath.has('i18n.title')).toBe(false)
	})

	it('marks lists and defaults them to the survivor rows', () => {
		expect(byPath.get('tags')).toMatchObject({ list: true, policy: 'nonEmpty' })
		expect(byPath.get('addresses')).toMatchObject({ list: true, policy: 'nonEmpty', type: 'array' })
	})

	it('takes a policy declared on the field', () => {
		expect(byPath.get('notes')).toMatchObject({ policy: 'union' })
	})

	it('refuses an unknown policy declared on a field, naming the field', () => {
		const bogus = [
			{ name: 'ref', type: 'text', admin: { custom: { dedupe: { policy: 'bogus' } } } },
		] as FlattenedField[]
		expect(() => deriveSpec({ flattenedFields: bogus })).toThrow(/"ref".*"bogus"/)
	})

	it('carries unique, required, hidden and relationTo through', () => {
		expect(byPath.get('email')).toMatchObject({ unique: true, policy: 'nonEmpty' })
		expect(byPath.get('name')).toMatchObject({ required: true, localized: true })
		expect(byPath.get('internal')).toMatchObject({ hidden: true, policy: 'survivor' })
		expect(byPath.get('company')).toMatchObject({ relationTo: 'companies' })
	})

	it('leaves out a field hidden from the API, which a read without `showHiddenFields` never holds', () => {
		expect(byPath.has('secret')).toBe(false)
	})

	it('keeps auth fields on a plain collection and drops them on an auth collection', () => {
		expect(byPath.has('password')).toBe(true)
		const auth = deriveSpec({ flattenedFields: fields, auth: {} })
		expect(auth.some((entry) => entry.path === 'password')).toBe(false)
		expect(auth.some((entry) => entry.path === 'hash')).toBe(false)
		expect(auth.some((entry) => entry.path === 'email')).toBe(true)
	})
})

describe('deriveSpec of a field with a component of its own', () => {
	const own = { components: { Field: '/components/Own#Own' } }
	const phone: FlattenedField = {
		name: 'phone',
		type: 'group',
		admin: own,
		fields: [],
		flattenedFields: [
			{ name: 'country', type: 'text' },
			{ name: 'number', type: 'text' },
		],
	}
	const labels: FlattenedField = {
		name: 'labels',
		type: 'array',
		admin: own,
		fields: [],
		flattenedFields: [{ name: 'text', type: 'text' }],
	}
	const color: FlattenedField = { name: 'color', type: 'text', admin: own }
	const spec = deriveSpec({ flattenedFields: [phone, labels, color] })
	const at = (path: string) => spec.find((entry) => entry.path === path)

	it('merges a group drawn by its own component whole, never part by part', () => {
		expect(spec.map((entry) => entry.path)).toEqual(['phone', 'labels', 'color'])
		expect(at('phone')).toMatchObject({ type: 'group', list: false, component: true })
	})

	it('takes a list drawn by its own component whole from one document', () => {
		expect(at('labels')).toMatchObject({ type: 'array', list: false, component: true })
	})

	it('marks a value drawn by its own component, to be shown with it', () => {
		expect(at('color')).toMatchObject({ type: 'text', component: true })
		expect(deriveSpec({ flattenedFields: [{ name: 'plain', type: 'text' }] })[0]?.component).toBe(
			false
		)
	})

	it('splits a group or list whose component declares it may be merged part by part', () => {
		const split = { ...own, custom: dedupeCustom({ split: true }) }
		const parts = deriveSpec({
			flattenedFields: [
				{ ...phone, admin: split },
				{ ...labels, admin: split },
			] as FlattenedField[],
		})
		expect(parts.map((entry) => entry.path)).toEqual(['phone.country', 'phone.number', 'labels'])
		expect(parts.find((entry) => entry.path === 'labels')).toMatchObject({ list: true })
	})

	it('takes a policy declared on such a group, and refuses one declared inside it', () => {
		const declared = deriveSpec({
			flattenedFields: [
				{ ...phone, admin: { ...own, custom: dedupeCustom({ policy: 'manual' }) } },
			] as FlattenedField[],
		})
		expect(declared[0]).toMatchObject({ path: 'phone', policy: 'manual' })
		expect(() =>
			deriveSpec({
				flattenedFields: [
					{
						...phone,
						flattenedFields: [
							{
								name: 'country',
								type: 'text',
								admin: { custom: dedupeCustom({ policy: 'manual' }) },
							},
						],
					},
				] as FlattenedField[],
			})
		).toThrow(/"phone.country".*declare it on "phone"/)
	})

	it('refuses a split flag that is not a boolean', () => {
		expect(() =>
			deriveSpec({
				flattenedFields: [
					{ ...phone, admin: { ...own, custom: { dedupe: { split: 'yes' } } } },
				] as FlattenedField[],
			})
		).toThrow(/"phone".*split/)
	})
})

describe('resolveSpec', () => {
	const derived = deriveSpec({ flattenedFields: fields })

	it('returns the derived spec without a seam', () => {
		expect(resolveSpec(derived, undefined, 'customers')).toBe(derived)
	})

	it('applies the seam', () => {
		const resolved = resolveSpec(
			derived,
			(spec) =>
				spec.map((entry) => (entry.path === 'email' ? { ...entry, policy: 'manual' } : entry)),
			'customers'
		)
		expect(resolved.find((entry) => entry.path === 'email')?.policy).toBe('manual')
	})

	it('refuses a path the schema does not have', () => {
		expect(() =>
			resolveSpec(
				derived,
				(spec) => [...spec, { ...(spec[0] as (typeof spec)[0]), path: 'nope' }],
				'customers'
			)
		).toThrow(/no field at path "nope"/)
	})
})

describe('labelPrefixes', () => {
	const sanitized: Field[] = [
		{ name: 'name', type: 'text', label: 'Name' },
		{
			name: 'profile',
			type: 'group',
			label: { en: 'Customer profile', de: 'Kundenprofil' },
			fields: [
				{ name: 'bio', type: 'textarea', label: 'Bio' },
				{
					type: 'collapsible',
					label: 'Rating',
					fields: [{ type: 'row', fields: [{ name: 'score', type: 'number', label: 'Score' }] }],
				},
			],
		},
		{ type: 'group', label: 'Contact', fields: [{ name: 'phone', type: 'text', label: 'Phone' }] },
		{
			type: 'tabs',
			tabs: [
				{ label: 'Meta', fields: [{ name: 'note', type: 'text', label: 'Note' }] },
				{ name: 'extra', label: 'Extra', fields: [{ name: 'code', type: 'text', label: 'Code' }] },
			],
		},
		{
			name: 'addresses',
			type: 'array',
			label: 'Addresses',
			fields: [{ name: 'city', type: 'text', label: 'City' }],
		},
	]
	const prefixes = labelPrefixes(sanitized)

	it("gives each data field the labels the list's filter writes before its own", () => {
		expect(prefixes.get('name')).toEqual([])
		expect(prefixes.get('profile')).toEqual([])
		expect(prefixes.get('profile.bio')).toEqual([{ en: 'Customer profile', de: 'Kundenprofil' }])
		expect(prefixes.get('profile.score')).toEqual([
			{ en: 'Customer profile', de: 'Kundenprofil' },
			'Rating',
		])
		expect(prefixes.get('phone')).toEqual(['Contact'])
		expect(prefixes.get('extra.code')).toEqual(['Extra'])
	})

	it('leaves out an unnamed tab and a row, as the filter does', () => {
		expect(prefixes.get('note')).toEqual([])
	})

	it('stops at a list, which the merge takes as one value', () => {
		expect(prefixes.get('addresses')).toEqual([])
		expect(prefixes.has('addresses.city')).toBe(false)
	})
})

describe('fullLabel', () => {
	const col = {
		labelPrefixes: new Map([
			['profile.score', [{ en: 'Customer profile', de: 'Kundenprofil' }, 'Rating']],
			['profile.bio', [{ en: 'Customer profile', de: 'Kundenprofil' }]],
		]),
		specByPath: new Map([
			['profile.score', { label: { en: 'Score', de: 'Punkte' } }],
			['profile.bio', { label: false }],
		]),
	} as unknown as Parameters<typeof fullLabel>[1]
	const i18n = (language: string) =>
		({ language, fallbackLanguage: 'en' }) as unknown as Parameters<typeof fullLabel>[2]

	it("joins the labels a field sits in with its own, in the reader's language", () => {
		expect(fullLabel('profile.score', col, i18n('de'))).toBe('Kundenprofil > Rating > Punkte')
		expect(fullLabel('profile.score', col, i18n('en'))).toBe('Customer profile > Rating > Score')
	})

	it('names a field without a label of its own by its name', () => {
		expect(fullLabel('profile.bio', col, i18n('en'))).toBe('Customer profile > Bio')
	})
})
