import type { Field, LabelFunction, PayloadRequest } from 'payload'
import { flattenAllFields } from 'payload/shared'
import { describe, expect, it } from 'vitest'
import { findNamedField, presetsFromDoc } from './presetsFromDoc'

const primaryLabel = { de: 'Primär', en: 'Primary' }

const fnLabel: LabelFunction = ({ i18n }) =>
	i18n.language === 'de' ? 'Funktionslabel' : 'Function label'

const fixtureFields: Field[] = [
	{ name: 'name', type: 'text' },
	{ name: 'primary', type: 'text', label: primaryLabel },
	{ name: 'accent', type: 'text' },
	{ type: 'row', fields: [{ name: 'highlight', type: 'text', label: 'Highlight' }] },
	{
		name: 'brand',
		type: 'group',
		fields: [{ name: 'surface', type: 'text', label: 'Surface' }],
	},
	{
		type: 'tabs',
		tabs: [{ name: 'theme', fields: [{ name: 'ink', type: 'text' }] }],
	},
	{ name: 'fnLabeled', type: 'text', label: fnLabel },
	{ name: 'noLabelText', type: 'text', label: false },
]

const flattened = flattenAllFields({ fields: fixtureFields })

const buildReq = (language = 'en'): PayloadRequest => {
	const t = (key: string) => key
	return {
		i18n: { language, t },
		payload: { collections: { tenants: { config: { flattenedFields: flattened } } } },
	} as unknown as PayloadRequest
}

const doc: Record<string, unknown> = {
	accent: '#f59e0b',
	brand: { surface: '#f5f3ff' },
	fnLabeled: '#111111',
	highlight: '#22d3ee',
	name: 'acme',
	noLabelText: '#222222',
	primary: '#7c3aed',
	theme: { ink: '#0f172a' },
}

describe('findNamedField', () => {
	it('finds top-level fields', () => {
		const field = findNamedField(flattened, 'primary')
		expect(field?.name).toBe('primary')
	})

	it('finds fields nested in rows at the top level', () => {
		const field = findNamedField(flattened, 'highlight')
		expect(field?.name).toBe('highlight')
	})

	it('finds group fields via dot path', () => {
		const field = findNamedField(flattened, 'brand.surface')
		expect(field?.name).toBe('surface')
	})

	it('finds named-tab fields via dot path', () => {
		const field = findNamedField(flattened, 'theme.ink')
		expect(field?.name).toBe('ink')
	})

	it('returns undefined for missing fields and dead paths', () => {
		expect(findNamedField(flattened, 'ghost')).toBeUndefined()
		expect(findNamedField(flattened, 'primary.nested')).toBeUndefined()
		expect(findNamedField(flattened, 'brand.ghost')).toBeUndefined()
		expect(findNamedField(undefined, 'primary')).toBeUndefined()
	})
})

describe('presetsFromDoc', () => {
	it('lifts named fields into keyed presets with the field label', () => {
		const presets = presetsFromDoc({
			collection: 'tenants',
			doc,
			fields: ['primary', 'highlight', 'brand.surface', 'theme.ink'],
			keyPrefix: 'acme/',
			req: buildReq(),
		})
		expect(presets).toEqual([
			{ key: 'acme/primary', label: primaryLabel, value: '#7c3aed' },
			{ key: 'acme/highlight', label: 'Highlight', value: '#22d3ee' },
			{ key: 'acme/brand.surface', label: 'Surface', value: '#f5f3ff' },
			{ key: 'acme/theme.ink', label: 'ink', value: '#0f172a' },
		])
	})

	it('passes localized record labels through by reference', () => {
		const [preset] = presetsFromDoc({
			collection: 'tenants',
			doc,
			fields: ['primary'],
			req: buildReq(),
		})
		expect(typeof preset === 'object' && preset.label).toBe(primaryLabel)
	})

	it('resolves function labels through req.i18n', () => {
		const [de] = presetsFromDoc({
			collection: 'tenants',
			doc,
			fields: ['fnLabeled'],
			req: buildReq('de'),
		})
		expect(typeof de === 'object' && de.label).toBe('Funktionslabel')
		const [en] = presetsFromDoc({
			collection: 'tenants',
			doc,
			fields: ['fnLabeled'],
			req: buildReq(),
		})
		expect(typeof en === 'object' && en.label).toBe('Function label')
	})

	it('falls back to the field name when the label is missing or false', () => {
		const presets = presetsFromDoc({
			collection: 'tenants',
			doc,
			fields: ['accent', 'noLabelText'],
			req: buildReq(),
		})
		expect(presets).toEqual([
			{ key: 'accent', label: 'accent', value: '#f59e0b' },
			{ key: 'noLabelText', label: 'noLabelText', value: '#222222' },
		])
	})

	it('skips missing fields and empty, non-string, or preset-ref values without throwing', () => {
		const sparse: Record<string, unknown> = {
			accent: '',
			fnLabeled: 42,
			highlight: 'preset:acme/primary',
			primary: null,
		}
		const presets = presetsFromDoc({
			collection: 'tenants',
			doc: sparse,
			fields: ['ghost', 'primary', 'accent', 'fnLabeled', 'highlight', 'brand.surface'],
			req: buildReq(),
		})
		expect(presets).toEqual([])
	})

	it('throws on an unknown collection', () => {
		expect(() =>
			presetsFromDoc({ collection: 'nope', doc, fields: ['primary'], req: buildReq() })
		).toThrow('unknown collection "nope"')
	})
})
