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
	multistep: false,
	pollEnabled: true,
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

	it('surfaces an error instead of empty results when the load fails', async () => {
		const fetchResultsImpl = vi
			.fn()
			.mockResolvedValue({ ok: false, message: 'boom' } as FetchResultsResult)
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', hasVoted: true, fetchResultsImpl })
		)
		await waitFor(() => expect(within(container).getByRole('alert')).toBeInTheDocument())
		// A failed load must not read as a zero-count result set ("no votes yet").
		expect(within(container).getByRole('alert')).toHaveTextContent('Results could not be loaded.')
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})

	it('falls back to localStorage when hasVoted is false (cookie absent)', async () => {
		window.localStorage.setItem('fb-poll-1', '1')
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, { form, resultsField: 'colour', hasVoted: false, fetchResultsImpl })
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})

	it('renders a closed notice plus results once closesAt has passed', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const closedForm = {
			...form,
			poll: { enabled: true, closesAt: new Date(Date.now() - 60_000).toISOString() },
		}
		const { container } = render(
			createElement(Poll, { form: closedForm, resultsField: 'colour', fetchResultsImpl })
		)
		expect(within(container).getByText('This poll is closed.')).toBeInTheDocument()
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() => expect(within(container).getByText('100%')).toBeInTheDocument())
	})

	it('keeps the form while closesAt is in the future', () => {
		const openForm = {
			...form,
			poll: { enabled: true, closesAt: new Date(Date.now() + 60 * 60_000).toISOString() },
		}
		const { container } = render(
			createElement(Poll, { form: openForm, resultsField: 'colour', fetchResultsImpl: vi.fn() })
		)
		expect(within(container).getByRole('button', { name: /submit|vote/i })).toBeInTheDocument()
	})

	it('shows a wait notice instead of fetching when an afterClose poll is voted but still open', async () => {
		window.localStorage.setItem('fb-poll-1', '1')
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const awaitCloseForm = {
			...form,
			poll: {
				enabled: true,
				resultsVisibility: 'afterClose' as const,
				closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
			},
		}
		const { container } = render(
			createElement(Poll, { form: awaitCloseForm, resultsField: 'colour', fetchResultsImpl })
		)
		await waitFor(() =>
			expect(
				within(container).getByText('Results will be shown after the poll closes.')
			).toBeInTheDocument()
		)
		expect(fetchResultsImpl).not.toHaveBeenCalled()
	})

	it('renders the final state with winner highlight once an outcome is recorded', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const finalForm = {
			...form,
			poll: { enabled: true, outcome: { winningValues: ['red'] } },
		}
		const { container } = render(
			createElement(Poll, { form: finalForm, resultsField: 'colour', fetchResultsImpl })
		)
		expect(within(container).getByText('Final result')).toBeInTheDocument()
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() =>
			expect(container.querySelector('.fb-results__bucket--winner')?.textContent).toContain('Red')
		)
	})

	it('highlights every winner when the recorded outcome is a tie', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const tiedForm = {
			...form,
			poll: { enabled: true, outcome: { winningValues: ['red', 'blue'] } },
		}
		const { container } = render(
			createElement(Poll, { form: tiedForm, resultsField: 'colour', fetchResultsImpl })
		)
		expect(within(container).getByText('Final result')).toBeInTheDocument()
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() =>
			expect(container.querySelectorAll('.fb-results__bucket--winner')).toHaveLength(2)
		)
		const winners = [...container.querySelectorAll('.fb-results__bucket--winner')].map(
			(node) => node.textContent ?? ''
		)
		expect(winners.some((entry) => entry.includes('Red'))).toBe(true)
		expect(winners.some((entry) => entry.includes('Blue'))).toBe(true)
	})

	it('outcome supersedes the closed and afterClose states', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const finalClosedForm = {
			...form,
			poll: {
				enabled: true,
				resultsVisibility: 'afterClose' as const,
				closesAt: new Date(Date.now() - 60_000).toISOString(),
				outcome: { winningValues: ['red'] },
			},
		}
		const { container } = render(
			createElement(Poll, { form: finalClosedForm, resultsField: 'colour', fetchResultsImpl })
		)
		expect(within(container).getByText('Final result')).toBeInTheDocument()
		expect(within(container).queryByText('This poll is closed.')).toBeNull()
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
	})

	it('shows the wait notice after voting on an open afterClose poll', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '5' })
		const awaitCloseForm = {
			...form,
			poll: {
				enabled: true,
				resultsVisibility: 'afterClose' as const,
				closesAt: new Date(Date.now() + 60 * 60_000).toISOString(),
			},
		}
		const { container } = render(
			createElement(Poll, {
				form: awaitCloseForm,
				resultsField: 'colour',
				onSubmit,
				fetchResultsImpl,
			})
		)
		const select = within(container).getByRole('combobox')
		fireEvent.change(select, { target: { value: 'red' } })
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))
		await waitFor(() =>
			expect(
				within(container).getByText('Results will be shown after the poll closes.')
			).toBeInTheDocument()
		)
		expect(fetchResultsImpl).not.toHaveBeenCalled()
	})
})
