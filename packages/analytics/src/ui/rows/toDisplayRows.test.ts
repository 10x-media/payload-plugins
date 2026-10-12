import { describe, expect, it } from 'vitest'
import { keys } from '../../translations/keys'
import { type DisplayContext, sourceRowsOf, toDisplayRows } from './toDisplayRows'

const t = (key: string): string => key

const context = (over: Partial<DisplayContext> = {}): DisplayContext => ({
	dimension: 'page',
	provider: 'native',
	t,
	locale: 'en',
	countryFlags: true,
	...over,
})

describe('toDisplayRows', () => {
	it('names a goal row by its name, and keeps the slug as the value a filter uses', () => {
		const [row] = toDisplayRows([{ value: 'signup', metrics: { conversions: 3 } }], {
			...context({ dimension: 'goal' }),
			goals: [{ slug: 'signup', name: 'Newsletter signup' }],
		})
		expect(row?.label).toBe('Newsletter signup')
		expect(row?.value).toBe('signup')
		expect(row?.key).toBe('signup')
	})

	it('keeps the slug for a goal no configured goal claims', () => {
		const [row] = toDisplayRows([{ value: 'retired', metrics: { conversions: 1 } }], {
			...context({ dimension: 'goal' }),
			goals: [],
		})
		expect(row?.label).toBe('retired')
	})

	it('says Not set for a row the source answered with no value, and never offers it as a filter', () => {
		const rows = toDisplayRows(
			[
				{ value: '', metrics: { pageviews: 4 } },
				{ value: undefined, metrics: { pageviews: 2 } },
				{ value: '/pricing', metrics: { pageviews: 1 } },
			],
			context()
		)
		expect(rows.map((row) => [row.label, row.unset, row.key])).toEqual([
			[keys.valueNotSet, true, 'row-0'],
			[keys.valueNotSet, true, 'row-1'],
			['/pricing', false, '/pricing'],
		])
	})

	it('leaves a latent built-in goal out until someone converts on it', () => {
		const ctx = { ...context({ dimension: 'goal' }), builtinGoalSlugs: ['purchase'] }
		expect(toDisplayRows([{ value: 'purchase', metrics: { conversions: 0 } }], ctx)).toEqual([])
		expect(
			toDisplayRows([{ value: 'purchase', metrics: { conversions: 2 } }], ctx).map(
				(row) => row.value
			)
		).toEqual(['purchase'])
		// Only a goal breakdown has latent rows: a page called `purchase` is a plain page.
		expect(
			toDisplayRows([{ value: 'purchase', metrics: { conversions: 0 } }], {
				...context(),
				builtinGoalSlugs: ['purchase'],
			})
		).toHaveLength(1)
	})

	it('draws a flag for a country code when flags are on, and for nothing else', () => {
		const rows = (countryFlags: boolean) =>
			toDisplayRows(
				[
					{ value: 'DE', metrics: {} },
					{ value: 'Germany', metrics: {} },
					{ value: '', metrics: {} },
				],
				context({ dimension: 'country', countryFlags })
			).map((row) => row.flag)
		expect(rows(true)).toEqual(['DE', null, null])
		expect(rows(false)).toEqual([null, null, null])
		expect(
			toDisplayRows([{ value: 'DE', metrics: {} }], context({ dimension: 'page' }))[0]?.flag
		).toBeNull()
	})

	it("derives a goal's or an event's rate from the site's visitors", () => {
		const [goal] = toDisplayRows([{ value: 'signup', metrics: { visitors: 25 } }], {
			...context({ dimension: 'goal' }),
			siteVisitors: 100,
		})
		expect(goal?.rate).toBe(0.25)
		const [event] = toDisplayRows([{ value: 'download', metrics: { visitors: 10 } }], {
			...context({ dimension: 'event' }),
		})
		expect(event?.rate).toBeNull()
	})

	it("derives an item's click rate from its own clicks and views", () => {
		const [item] = toDisplayRows(
			[{ value: 'offers:1', metrics: { impressions: 200, interactions: 50 } }],
			{ ...context({ dimension: 'item' }), itemLabels: { 'offers:1': 'Spring offer' } }
		)
		expect(item?.rate).toBe(0.25)
		expect(item?.label).toBe('Spring offer')
	})

	it('carries no rate for a dimension that has none', () => {
		const [row] = toDisplayRows([{ value: '/', metrics: { visitors: 5 } }], {
			...context(),
			siteVisitors: 10,
		})
		expect(row?.rate).toBeUndefined()
	})
})

describe('sourceRowsOf', () => {
	it("reads each row's value for the dimension, absent where the row carries none", () => {
		expect(
			sourceRowsOf(
				[
					{ dimensions: { page: '/a' }, metrics: { pageviews: 1 } },
					{ dimensions: { country: 'DE' }, metrics: { pageviews: 2 } },
				],
				'page'
			)
		).toEqual([
			{ value: '/a', metrics: { pageviews: 1 } },
			{ value: undefined, metrics: { pageviews: 2 } },
		])
	})
})
