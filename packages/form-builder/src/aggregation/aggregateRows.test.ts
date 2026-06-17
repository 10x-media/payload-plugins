import { describe, expect, it } from 'vitest'
import { aggregateRowForField, aggregateRowsForFields } from './aggregateRows'
import type { AggregationRow, FieldMeta } from './types'

const meta = (over: Partial<FieldMeta> = {}): FieldMeta => ({
	field: 'fav',
	label: 'Favourite',
	fieldType: 'select',
	options: [
		{ value: 'red', label: 'Red' },
		{ value: 'blue', label: 'Blue' },
		{ value: 'green', label: 'Green' },
	],
	...over,
})

const row = (value: unknown): AggregationRow => ({ values: [{ field: 'fav', value }] })

describe('aggregateRowForField', () => {
	it('counts scalar values and computes percentages over respondents', () => {
		const rows = [row('red'), row('red'), row('blue')]
		const agg = aggregateRowForField(rows, meta(), false)
		expect(agg.total).toBe(3)
		expect(agg.buckets.map((b) => [b.value, b.count, b.percentage])).toEqual([
			['red', 2, 66.7],
			['blue', 1, 33.3],
			['green', 0, 0],
		])
		expect(agg.label).toBe('Favourite')
		expect(agg.fieldType).toBe('select')
		expect(agg.truncated).toBe(false)
	})

	it('orders buckets by the option order, then leftover values by count desc', () => {
		const rows = [row('purple'), row('purple'), row('blue'), row('orange')]
		const agg = aggregateRowForField(rows, meta(), false)
		expect(agg.buckets.map((b) => b.value)).toEqual(['red', 'blue', 'green', 'purple', 'orange'])
	})

	it('skips empty answers and does not count them as respondents', () => {
		const rows = [row('red'), row(''), row(null), row(undefined), { values: [] }, {}]
		const agg = aggregateRowForField(rows, meta(), false)
		expect(agg.total).toBe(1)
		expect(agg.buckets.find((b) => b.value === 'red')?.count).toBe(1)
	})

	it('handles array (select-all) values: one bucket per element, one respondent', () => {
		const rows: AggregationRow[] = [
			{ values: [{ field: 'fav', value: ['red', 'blue'] }] },
			{ values: [{ field: 'fav', value: ['red'] }] },
		]
		const agg = aggregateRowForField(rows, meta(), false)
		expect(agg.total).toBe(2)
		expect(agg.buckets.find((b) => b.value === 'red')?.count).toBe(2)
		expect(agg.buckets.find((b) => b.value === 'blue')?.count).toBe(1)
		expect(agg.buckets.find((b) => b.value === 'red')?.percentage).toBe(100)
		expect(agg.buckets.find((b) => b.value === 'blue')?.percentage).toBe(50)
	})

	it('labels a retired value from the submitted descriptor snapshot when not in current options', () => {
		const rows: AggregationRow[] = [
			{
				values: [{ field: 'fav', value: 'teal' }],
				descriptors: [
					{
						field: 'fav',
						label: 'Favourite',
						fieldType: 'select',
						optionLabels: { teal: 'Teal (retired)' },
					},
				],
			},
		]
		const agg = aggregateRowForField(rows, meta(), false)
		expect(agg.buckets.find((b) => b.value === 'teal')?.label).toBe('Teal (retired)')
	})

	it('falls back to the raw value as the label when no option or snapshot label exists', () => {
		const rows = [row('cyan')]
		const agg = aggregateRowForField(rows, meta({ options: [] }), false)
		expect(agg.buckets.find((b) => b.value === 'cyan')?.label).toBe('cyan')
	})

	it('returns zero total and zero percentages with no rows', () => {
		const agg = aggregateRowForField([], meta(), false)
		expect(agg.total).toBe(0)
		expect(agg.buckets.every((b) => b.count === 0 && b.percentage === 0)).toBe(true)
	})

	it('propagates the truncated flag', () => {
		expect(aggregateRowForField([row('red')], meta(), true).truncated).toBe(true)
	})
})

describe('aggregateRowsForFields', () => {
	it('aggregates multiple fields in one pass', () => {
		const rows: AggregationRow[] = [
			{
				values: [
					{ field: 'fav', value: 'red' },
					{ field: 'size', value: 'm' },
				],
			},
			{
				values: [
					{ field: 'fav', value: 'blue' },
					{ field: 'size', value: 'm' },
				],
			},
		]
		const metas: FieldMeta[] = [
			meta(),
			{
				field: 'size',
				label: 'Size',
				fieldType: 'select',
				options: [
					{ value: 's', label: 'S' },
					{ value: 'm', label: 'M' },
				],
			},
		]
		const results = aggregateRowsForFields(rows, metas, false)
		expect(results).toHaveLength(2)
		expect(results[0]?.field).toBe('fav')
		expect(results[1]?.field).toBe('size')
		expect(results[1]?.buckets.find((b) => b.value === 'm')?.count).toBe(2)
	})
})
