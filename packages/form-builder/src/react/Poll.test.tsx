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

	it('forwards the resolved success response to a Poll host onSuccess', async () => {
		const onSuccess = vi.fn()
		const formWithResponse = {
			...form,
			response: {
				type: 'message' as const,
				message: {
					root: {
						type: 'root',
						children: [{ type: 'paragraph', children: [{ type: 'text', text: 'Voted!' }] }],
					},
				},
			},
		}
		const { container } = render(
			createElement(Poll, {
				form: formWithResponse,
				resultsField: 'colour',
				onSubmit: vi.fn().mockResolvedValue({ ok: true, submissionId: '9' }),
				fetchResultsImpl: vi.fn().mockResolvedValue(resultsOk()),
				onSuccess,
			})
		)
		fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'red' } })
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))
		await waitFor(() => expect(onSuccess).toHaveBeenCalled())
		const [id, result] = onSuccess.mock.calls[0] ?? []
		expect(id).toBe('9')
		expect(result?.response?.html).toContain('Voted!')
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

	it('reads and writes the voted flag through a custom voteStorage adapter', async () => {
		const store = new Set<string>()
		const voteStorage = {
			read: vi.fn((key: string) => store.has(key)),
			write: vi.fn((key: string) => {
				store.add(key)
			}),
		}
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '5' })
		const { container } = render(
			createElement(Poll, {
				form,
				resultsField: 'colour',
				onSubmit,
				fetchResultsImpl,
				adapters: { voteStorage },
			})
		)
		expect(voteStorage.read).toHaveBeenCalledWith('fb-poll-1')
		fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'red' } })
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))
		await waitFor(() => expect(voteStorage.write).toHaveBeenCalledWith('fb-poll-1'))
		expect(window.localStorage.getItem('fb-poll-1')).toBeNull()
	})

	it('skips the form when the custom voteStorage reports voted', async () => {
		const voteStorage = { read: () => true, write: vi.fn() }
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, {
				form,
				resultsField: 'colour',
				fetchResultsImpl,
				adapters: { voteStorage },
			})
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})

	it('performs no client persistence with voteStorage false', async () => {
		window.localStorage.setItem('fb-poll-1', '1')
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '5' })
		const { container } = render(
			createElement(Poll, {
				form,
				resultsField: 'colour',
				onSubmit,
				fetchResultsImpl,
				adapters: { voteStorage: false as const },
			})
		)
		// The pre-set localStorage flag is ignored: the form still renders.
		const select = within(container).getByRole('combobox')
		fireEvent.change(select, { target: { value: 'red' } })
		window.localStorage.clear()
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		expect(window.localStorage.getItem('fb-poll-1')).toBeNull()
	})

	it('voteStorage false still honors hasVoted', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, {
				form,
				resultsField: 'colour',
				hasVoted: true,
				fetchResultsImpl,
				adapters: { voteStorage: false as const },
			})
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		expect(within(container).queryByRole('button', { name: /submit|vote/i })).toBeNull()
	})

	it('currentVote implies voted and highlights the pick in results', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, {
				form: { ...form, poll: { allowChange: true } },
				resultsField: 'colour',
				currentVote: { value: 'red', pick: ['red'] },
				fetchResultsImpl,
			})
		)
		await waitFor(() => expect(fetchResultsImpl).toHaveBeenCalled())
		await waitFor(() =>
			expect(container.querySelector('.fb-results__bucket--yours')?.textContent).toContain('Red')
		)
		expect(within(container).queryByRole('combobox')).toBeNull()
	})

	it('offers a change-vote button only for an open allowChange poll', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const changeable = render(
			createElement(Poll, {
				form: { ...form, poll: { allowChange: true } },
				resultsField: 'colour',
				currentVote: { value: 'red', pick: ['red'] },
				fetchResultsImpl,
			})
		)
		await waitFor(() =>
			expect(
				within(changeable.container).getByRole('button', { name: 'Change vote' })
			).toBeInTheDocument()
		)
		cleanup()

		const fixed = render(
			createElement(Poll, {
				form,
				resultsField: 'colour',
				hasVoted: true,
				fetchResultsImpl: vi.fn().mockResolvedValue(resultsOk()),
			})
		)
		await waitFor(() => expect(within(fixed.container).getByText('Colour')).toBeInTheDocument())
		expect(within(fixed.container).queryByRole('button', { name: 'Change vote' })).toBeNull()
		cleanup()

		const closed = render(
			createElement(Poll, {
				form: {
					...form,
					poll: { allowChange: true, closesAt: new Date(Date.now() - 60_000).toISOString() },
				},
				resultsField: 'colour',
				currentVote: { value: 'red', pick: ['red'] },
				fetchResultsImpl: vi.fn().mockResolvedValue(resultsOk()),
			})
		)
		await waitFor(() =>
			expect(within(closed.container).getByText('This poll is closed.')).toBeInTheDocument()
		)
		expect(within(closed.container).queryByRole('button', { name: 'Change vote' })).toBeNull()
	})

	it('reopens the form prefilled with the current pick on change vote', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, {
				form: { ...form, poll: { allowChange: true } },
				resultsField: 'colour',
				// 'blue' so the assertion cannot pass via the select's native first-option default ('red').
				currentVote: { value: 'blue', pick: ['blue'] },
				fetchResultsImpl,
			})
		)
		await waitFor(() =>
			expect(within(container).getByRole('button', { name: 'Change vote' })).toBeInTheDocument()
		)
		fireEvent.click(within(container).getByRole('button', { name: 'Change vote' }))
		const select = within(container).getByRole('combobox') as HTMLSelectElement
		expect(select.value).toBe('blue')
	})

	it('returns to results with the updated pick after a successful change', async () => {
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '5' })
		const { container } = render(
			createElement(Poll, {
				form: { ...form, poll: { allowChange: true } },
				resultsField: 'colour',
				currentVote: { value: 'red', pick: ['red'] },
				onSubmit,
				fetchResultsImpl,
			})
		)
		await waitFor(() =>
			expect(within(container).getByRole('button', { name: 'Change vote' })).toBeInTheDocument()
		)
		fireEvent.click(within(container).getByRole('button', { name: 'Change vote' }))
		fireEvent.change(within(container).getByRole('combobox'), { target: { value: 'blue' } })
		fireEvent.click(within(container).getByRole('button', { name: /submit|vote/i }))

		await waitFor(() =>
			expect(container.querySelector('.fb-results__bucket--yours')?.textContent).toContain('Blue')
		)
		expect(onSubmit).toHaveBeenCalledTimes(1)
		expect(within(container).queryByRole('combobox')).toBeNull()
	})

	it('offers changing without a prefill when voted is only known locally', async () => {
		window.localStorage.setItem('fb-poll-1', '1')
		const fetchResultsImpl = vi.fn().mockResolvedValue(resultsOk())
		const { container } = render(
			createElement(Poll, {
				form: { ...form, poll: { allowChange: true } },
				resultsField: 'colour',
				fetchResultsImpl,
			})
		)
		await waitFor(() =>
			expect(within(container).getByRole('button', { name: 'Change vote' })).toBeInTheDocument()
		)
		fireEvent.click(within(container).getByRole('button', { name: 'Change vote' }))
		// No stored pick to prefill: the select sits on its native first-option default.
		const select = within(container).getByRole('combobox') as HTMLSelectElement
		expect(select.value).toBe('red')
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
