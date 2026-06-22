import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FetchResultsResult } from './fetchResults'
import { Poll } from './Poll'

afterEach(() => {
	cleanup()
	window.localStorage.clear()
})

beforeEach(() => {
	window.localStorage.clear()
})

const form = {
	id: 1,
	fields: [
		{
			blockType: 'select',
			name: 'colour',
			label: 'Colour',
			options: [
				{ label: 'Red', value: 'red' },
				{ label: 'Blue', value: 'blue' },
			],
		},
	],
}

const resultsOk = (): FetchResultsResult => ({
	ok: true,
	results: [
		{
			field: 'colour',
			label: 'Colour',
			fieldType: 'select',
			total: 1,
			truncated: false,
			buckets: [
				{ value: 'red', label: 'Red', count: 1, percentage: 100 },
				{ value: 'blue', label: 'Blue', count: 0, percentage: 0 },
			],
		},
	],
})

describe('Poll', () => {
	it('renders the form first when not yet voted', () => {
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', fetchResultsImpl: vi.fn() })
		)
		expect(within(container).getByRole('button', { name: /submit|vote/i })).toBeInTheDocument()
	})

	it('shows results after a successful submit and persists the voted flag', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '5' })
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', onSubmit, fetchResultsImpl })
		)
		const select = within(container).getByRole('combobox')
		fireEvent.change(select, { target: { value: 'red' } })
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() => expect(within(container).getByText('100%')).toBeInTheDocument())
		expect(window.localStorage.getItem('fb-poll-1')).not.toBeNull()
	})

	it('shows results immediately (skips the form) when already voted', async () => {
		window.localStorage.setItem('fb-poll-1', '1')
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', fetchResultsImpl })
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() => expect(within(container).getByText('Colour')).toBeInTheDocument())
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})

	it('respects a controlled hasVoted prop', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', hasVoted: true, fetchResultsImpl })
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})
})
