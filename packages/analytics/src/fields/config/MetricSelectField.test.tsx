import { cleanup, render } from '@testing-library/react'
import type { SelectFieldClientProps } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MetricSelectField } from './MetricSelectField'

type FilterOption = (option: { label: string; value: string }, search: string) => boolean

const mocks = vi.hoisted(() => ({
	selectFilterOptions: undefined as Array<string | { label: string; value: string }> | undefined,
	options: [] as Array<{ label: string; value: string }>,
	filterOption: undefined as FilterOption | undefined,
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: () => ({}) }))

vi.mock('@payloadcms/ui', () => ({
	SelectInput: (props: {
		options: Array<{ label: string; value: string }>
		filterOption?: FilterOption
	}) => {
		mocks.options = props.options
		mocks.filterOption = props.filterOption
		return null
	},
	useField: () => ({
		path: 'metric',
		selectFilterOptions: mocks.selectFilterOptions,
		setValue: () => {},
		showError: false,
		value: 'sessions',
	}),
	useFormFields: () => undefined,
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

vi.mock('./useAnalyticsSources', () => ({ useAnalyticsSources: () => ({ sources: [] }) }))

afterEach(() => {
	cleanup()
	mocks.selectFilterOptions = undefined
})

const field = {
	name: 'metric',
	type: 'select',
	label: 'Metric',
	options: [
		{ label: 'Visits', value: 'visits' },
		{ label: 'Visits', value: 'sessions' },
		{ label: 'Pageviews', value: 'pageviews' },
	],
} as unknown as SelectFieldClientProps['field']

const shown = (): string[] =>
	mocks.options
		.filter((option) => mocks.filterOption?.(option, '') ?? true)
		.map((option) => option.value)

describe('MetricSelectField', () => {
	// The server narrows the options to one "Visits" where a source counts visits and sessions
	// alike; the picker has to honour that, as Payload's own select field does.
	it("offers only what the field's filterOptions allow", () => {
		mocks.selectFilterOptions = ['sessions', 'pageviews']
		render(<MetricSelectField field={field} path="metric" />)
		expect(shown()).toEqual(['sessions', 'pageviews'])
		// The stored value is still named, only the menu leaves the others out.
		expect(mocks.options.map((option) => option.value)).toEqual(['visits', 'sessions', 'pageviews'])
	})

	it('still searches by label among what it offers', () => {
		mocks.selectFilterOptions = [{ label: 'Visits', value: 'sessions' }, 'pageviews']
		render(<MetricSelectField field={field} path="metric" />)
		expect(mocks.filterOption?.({ label: 'Pageviews', value: 'pageviews' }, 'page')).toBe(true)
		expect(mocks.filterOption?.({ label: 'Pageviews', value: 'pageviews' }, 'visit')).toBe(false)
		expect(mocks.filterOption?.({ label: 'Visits', value: 'visits' }, 'visit')).toBe(false)
	})

	it('offers every option where the field sets no filter', () => {
		render(<MetricSelectField field={field} path="metric" />)
		expect(mocks.filterOption).toBeUndefined()
		expect(shown()).toEqual(['visits', 'sessions', 'pageviews'])
	})
})
