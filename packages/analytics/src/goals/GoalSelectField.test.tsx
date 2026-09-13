import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TextFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import type { GoalsResponse } from './fetchGoals'
import { GoalSelectField } from './GoalSelectField'

const state = vi.hoisted(() => ({
	setValue: vi.fn(),
	userId: 'user-0',
	value: '',
}))

vi.mock('@payloadcms/ui', () => {
	type MockSelectProps = {
		AfterInput?: ReactNode
		Description?: ReactNode
		description?: string
		label?: string
		name: string
		onChange?: (option: { label: string; value: string }) => void
		options?: Array<{ label: string; value: string }>
		readOnly?: boolean
		value?: string
	}
	return {
		SelectInput: ({
			AfterInput,
			Description,
			description,
			label,
			name,
			onChange,
			options = [],
			readOnly,
			value,
		}: MockSelectProps) => (
			<div>
				<span data-testid="label">{label ?? ''}</span>
				<span data-testid="description">{description ?? ''}</span>
				<select
					aria-label="goal"
					disabled={readOnly}
					name={name}
					onChange={(event) => onChange?.({ label: event.target.value, value: event.target.value })}
					value={value ?? ''}
				>
					<option value="">none</option>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				{AfterInput}
				{Description}
			</div>
		),
		useAuth: () => ({ user: { id: state.userId } }),
		useConfig: () => ({
			config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
		}),
		useField: () => ({
			customComponents: {},
			disabled: false,
			path: 'goal',
			setValue: state.setValue,
			showError: false,
			value: state.value,
		}),
		useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
	}
})

const fetchMock = vi.fn()

const answer = (body: GoalsResponse) =>
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
	)

const props = (overrides: Record<string, unknown> = {}): TextFieldClientProps =>
	({
		field: { name: 'goal', type: 'text', label: 'Goal' },
		path: 'goal',
		readOnly: false,
		...overrides,
	}) as unknown as TextFieldClientProps

let userSeq = 0

beforeEach(() => {
	userSeq += 1
	// The fetch is cached per user, so each test acts as a different user.
	state.userId = `user-${userSeq}`
	state.value = ''
	state.setValue.mockClear()
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	cleanup()
})

describe('GoalSelectField', () => {
	it('renders the fetched goals as options', async () => {
		answer({
			collection: { slug: 'analytics-goals' },
			goals: [
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
				{ name: 'Newsletter', slug: 'newsletter', source: 'collection' },
			],
		})

		render(<GoalSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: 'Book a demo' })).toBeDefined()
		expect(screen.getByRole('option', { name: 'Newsletter' })).toBeDefined()
	})

	it('fetches the goals endpoint under the configured api route', async () => {
		answer({ collection: null, goals: [{ name: 'Signup', slug: 'signup', source: 'config' }] })

		render(<GoalSelectField {...props()} />)

		await screen.findByRole('option', { name: 'Signup' })
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cms.test/api/analytics/goals')
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit)?.credentials).toBe('same-origin')
	})

	it('stores the slug when a goal is picked', async () => {
		answer({
			collection: null,
			goals: [{ name: 'Book a demo', slug: 'book-demo', source: 'config' }],
		})

		render(<GoalSelectField {...props()} />)
		const select = (await screen.findByLabelText('goal')) as HTMLSelectElement
		select.value = 'book-demo'
		select.dispatchEvent(new Event('change', { bubbles: true }))

		await waitFor(() => expect(state.setValue).toHaveBeenCalledWith('book-demo'))
	})

	it('shows the empty state with a link to the goals collection', async () => {
		answer({ collection: { slug: 'analytics-goals' }, goals: [] })

		render(<GoalSelectField {...props()} />)

		const link = (await screen.findByRole('link', {
			name: keys.fieldGoalManage,
		})) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe('/admin/collections/analytics-goals')
		expect(screen.getByText(keys.fieldGoalEmpty, { exact: false })).toBeDefined()
	})

	it('shows the empty state without a link when no collection is enabled', async () => {
		answer({ collection: null, goals: [] })

		render(<GoalSelectField {...props()} />)

		await screen.findByText(keys.fieldGoalEmpty)
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('disables the picker once the empty answer is in', async () => {
		answer({ collection: null, goals: [] })

		render(<GoalSelectField {...props()} />)

		await screen.findByText(keys.fieldGoalEmpty)
		expect((screen.getByLabelText('goal') as HTMLSelectElement).disabled).toBe(true)
	})

	it('keeps the field description while goals are loading', () => {
		answer({ collection: null, goals: [] })

		render(
			<GoalSelectField
				{...props({
					field: { name: 'goal', type: 'text', label: 'Goal', admin: { description: 'Pick one' } },
				})}
			/>
		)

		expect(screen.getByTestId('description').textContent).toBe('Pick one')
	})
})
