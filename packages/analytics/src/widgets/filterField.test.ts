import type {
	Field,
	LabelFunction,
	NamedGroupField,
	TextField,
	TextFieldSingleValidation,
} from 'payload'
import { describe, expect, it } from 'vitest'
import { MAX_QUERY_FILTER_VALUE_LENGTH } from '../query/limits'
import { keys } from '../translations/keys'
import {
	FILTER_DIMENSION_COMPONENT,
	FILTER_OPERATOR_COMPONENT,
	filterField,
	widgetFilters,
} from './filterField'

const subField = (group: NamedGroupField, name: string): TextField => {
	const found = group.fields.find((f: Field) => 'name' in f && f.name === name)
	if (!found) throw new Error(`no ${name} subfield`)
	return found as TextField
}

const componentPath = (field: TextField): string => {
	const component = field.admin?.components?.Field
	if (!component || typeof component !== 'object') throw new Error('expected a component object')
	return (component as { path: string }).path
}

const resolveLabel = (label: unknown): string =>
	(label as LabelFunction)({ i18n: {} as never, t: ((key: string) => key) as never })

const validateValue = (
	value: string | null,
	siblingData: Record<string, unknown>
): Promise<string | true> | string | true => {
	const validate = subField(filterField(), 'value').validate as TextFieldSingleValidation
	const options = {
		req: { t: (key: string) => key },
		siblingData,
	} as unknown as Parameters<TextFieldSingleValidation>[1]
	return validate(value, options)
}

describe('filterField', () => {
	it('builds a group named filter', () => {
		const group = filterField()

		expect(group.type).toBe('group')
		expect(group.name).toBe('filter')
		expect(group.fields.map((f: Field) => ('name' in f ? f.name : ''))).toEqual([
			'dimension',
			'operator',
			'value',
		])
	})

	it('labels and describes the group from the typed keys', () => {
		const group = filterField()

		expect(resolveLabel(group.label)).toBe(keys.widgetFieldFilter)
		expect(resolveLabel(group.admin?.description)).toBe(keys.widgetFieldFilterDescription)
	})

	it('renders the dimension with the scoped dimension picker', () => {
		const dimension = subField(filterField(), 'dimension')

		expect(dimension.type).toBe('text')
		expect(componentPath(dimension)).toBe(FILTER_DIMENSION_COMPONENT)
		expect(FILTER_DIMENSION_COMPONENT).toBe(
			'@10x-media/analytics/client#FilterDimensionSelectField'
		)
		expect(resolveLabel(dimension.label)).toBe(keys.widgetFieldFilterDimension)
	})

	it('renders the operator with the scoped operator picker and defaults it to eq', () => {
		const operator = subField(filterField(), 'operator')

		expect(operator.type).toBe('text')
		expect(operator.defaultValue).toBe('eq')
		expect(componentPath(operator)).toBe(FILTER_OPERATOR_COMPONENT)
		expect(FILTER_OPERATOR_COMPONENT).toBe('@10x-media/analytics/client#FilterOperatorSelectField')
		expect(resolveLabel(operator.label)).toBe(keys.widgetFieldFilterOperator)
	})

	it('caps the stored value at the query parser length', () => {
		const value = subField(filterField(), 'value')

		expect(value.type).toBe('text')
		expect(value.maxLength).toBe(MAX_QUERY_FILTER_VALUE_LENGTH)
		expect(value.maxLength).toBe(256)
		expect(resolveLabel(value.label)).toBe(keys.widgetFieldFilterValue)
	})

	it('accepts an empty value while no dimension is chosen', () => {
		expect(validateValue('', {})).toBe(true)
		expect(validateValue(null, { dimension: '' })).toBe(true)
	})

	it('requires a value once a dimension is chosen', () => {
		expect(validateValue('', { dimension: 'country' })).toBe(keys.widgetFilterValueRequired)
		expect(validateValue(null, { dimension: 'country' })).toBe(keys.widgetFilterValueRequired)
	})

	it('treats a whitespace-only value as empty', () => {
		expect(validateValue('   ', { dimension: 'country' })).toBe(keys.widgetFilterValueRequired)
	})

	it('accepts a value whose meaning survives trimming', () => {
		expect(validateValue('  DE  ', { dimension: 'country' })).toBe(true)
	})

	it('rejects a value longer than the cap, measured after trimming', () => {
		const long = 'x'.repeat(MAX_QUERY_FILTER_VALUE_LENGTH + 1)
		const atCap = `  ${'x'.repeat(MAX_QUERY_FILTER_VALUE_LENGTH)}  `

		expect(validateValue(long, { dimension: 'page' })).toBe(keys.widgetFilterValueTooLong)
		expect(validateValue(atCap, { dimension: 'page' })).toBe(true)
	})
})

describe('widgetFilters', () => {
	it('returns nothing for a widget carrying no filter group at all', () => {
		expect(widgetFilters({})).toEqual([])
	})

	it('returns nothing while the dimension is still unchosen', () => {
		expect(widgetFilters({ filter: { operator: 'eq', value: 'DE' } })).toEqual([])
	})

	it('returns nothing for a dimension with no value, blank or whitespace-only', () => {
		expect(widgetFilters({ filter: { dimension: 'country' } })).toEqual([])
		expect(widgetFilters({ filter: { dimension: 'country', value: '' } })).toEqual([])
		expect(widgetFilters({ filter: { dimension: 'country', value: '   ' } })).toEqual([])
	})

	it('defaults a missing operator to eq, so a half-stored group still reads', () => {
		expect(widgetFilters({ filter: { dimension: 'country', value: 'DE' } })).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
	})

	it('keeps the stored operator', () => {
		expect(
			widgetFilters({ filter: { dimension: 'page', operator: 'contains', value: '/blog' } })
		).toEqual([{ dimension: 'page', operator: 'contains', value: '/blog' }])
	})

	it('trims the value, which is stored as typed', () => {
		expect(widgetFilters({ filter: { dimension: 'country', value: '  DE  ' } })).toEqual([
			{ dimension: 'country', operator: 'eq', value: 'DE' },
		])
	})

	it('caps the value at the query limit after trimming', () => {
		const value = `  ${'x'.repeat(MAX_QUERY_FILTER_VALUE_LENGTH + 20)}  `
		const [filter] = widgetFilters({ filter: { dimension: 'page', value } })
		expect(filter?.value).toHaveLength(MAX_QUERY_FILTER_VALUE_LENGTH)
	})

	it('never returns more than the one filter a widget can hold', () => {
		expect(widgetFilters({ filter: { dimension: 'page', value: '/a' } })).toHaveLength(1)
	})
})
