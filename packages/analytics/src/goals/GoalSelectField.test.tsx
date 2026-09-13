import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TextFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import type { GoalsResponse } from './fetchGoals'
import { GoalSelectField } from './GoalSelectField'

const mocks = vi.hoisted(() => ({
	mergeFieldStyles: vi.fn(() => ({ width: '50%' })),
	path: 'goal',
	setValue: vi.fn(),
	useFieldArgs: [] as Array<Record<string, unknown>>,
	userId: 'user-0',
	value: '',
	withCondition: vi.fn((component: unknown) => component),
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: mocks.mergeFieldStyles }))

vi.mock('@payloadcms/ui', () => {
	type MockSelectProps = {
		AfterInput?: ReactNode
		Description?: ReactNode
		description?: string
		label?: string
		name: string
		onChange?: (option: { label: string; value: string }) => void
		options?: Array<{ label: string; value: string }>
		path: string
		placeholder?: string
		readOnly?: boolean
		style?: Record<string, string>
		value?: string
	}
	return {
		FieldDescription: ({ description }: { description?: string }) => (
			<span data-testid="description">{description ?? ''}</span>
		),
		SelectInput: ({
			AfterInput,
			Description,
			description,
			label,
			name,
			onChange,
			options = [],
			path,
			placeholder,
			readOnly,
			style,
			value,
		}: MockSelectProps) => (
			<div data-testid="wrap" data-width={style?.width ?? ''}>
				<span data-testid="label">{label ?? ''}</span>
				<span data-testid="static-description">{description ?? ''}</span>
				<span data-testid="path">{path}</span>
				<span data-testid="placeholder">{placeholder ?? ''}</span>
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
		useAuth: () => ({ user: { id: mocks.userId } }),
		useConfig: () => ({
			config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
		}),
		useField: (args: Record<string, unknown>) => {
			mocks.useFieldArgs.push(args)
			return {
				customComponents: {},
				disabled: false,
				path: mocks.path,
				setValue: mocks.setValue,
				showError: false,
				value: mocks.value,
			}
		},
		useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
		withCondition: mocks.withCondition,
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
	mocks.userId = `user-${userSeq}`
	mocks.path = 'goal'
	mocks.value = ''
	mocks.setValue.mockClear()
	mocks.useFieldArgs.length = 0
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	cleanup()
})

describe('GoalSelectField', () => {
	it('is wrapped in withCondition so admin.condition hides it', () => {
		expect(mocks.withCondition).toHaveBeenCalled()
	})

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

	it('fetches the goals endpoint under the configured api route with credentials', async () => {
		answer({ collection: null, goals: [{ name: 'Signup', slug: 'signup', source: 'config' }] })

		render(<GoalSelectField {...props()} />)

		await screen.findByRole('option', { name: 'Signup' })
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cms.test/api/analytics/goals')
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit)?.credentials).toBe('include')
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

		await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith('book-demo'))
	})

	it('follows the form state path rather than the possibly stale prop', async () => {
		answer({ collection: null, goals: [] })
		mocks.path = 'blocks.0.goal'

		render(<GoalSelectField {...props()} />)

		expect(mocks.useFieldArgs[0]).toEqual({ potentiallyStalePath: 'goal' })
		expect(screen.getByTestId('path').textContent).toBe('blocks.0.goal')
	})

	it('derives its style through mergeFieldStyles', () => {
		answer({ collection: null, goals: [] })

		render(<GoalSelectField {...props()} />)

		expect(mocks.mergeFieldStyles).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'goal', type: 'text' })
		)
		expect(screen.getByTestId('wrap').getAttribute('data-width')).toBe('50%')
	})

	it('forwards the admin placeholder', () => {
		answer({ collection: null, goals: [] })

		render(
			<GoalSelectField
				{...props({
					field: {
						name: 'goal',
						type: 'text',
						label: 'Goal',
						admin: { placeholder: 'Pick a goal' },
					},
				})}
			/>
		)

		expect(screen.getByTestId('placeholder').textContent).toBe('Pick a goal')
	})

	it('resolves a localized admin placeholder for the active locale', () => {
		answer({ collection: null, goals: [] })

		render(
			<GoalSelectField
				{...props({
					field: {
						name: 'goal',
						type: 'text',
						label: 'Goal',
						admin: { placeholder: { de: 'Ziel wählen', en: 'Pick a goal' } },
					},
				})}
			/>
		)

		expect(screen.getByTestId('placeholder').textContent).toBe('Pick a goal')
	})

	it('shows the empty notice with a link to the goals collection', async () => {
		answer({ collection: { slug: 'analytics-goals' }, goals: [] })

		render(<GoalSelectField {...props()} />)

		const link = (await screen.findByRole('link', {
			name: keys.fieldGoalManage,
		})) as HTMLAnchorElement
		expect(link.getAttribute('href')).toBe('/admin/collections/analytics-goals')
		expect(screen.getByText(keys.fieldGoalEmpty, { exact: false })).toBeDefined()
	})

	it('shows the empty notice without a link when no collection is enabled', async () => {
		answer({ collection: null, goals: [] })

		render(<GoalSelectField {...props()} />)

		await screen.findByText(keys.fieldGoalEmpty)
		expect(screen.queryByRole('link')).toBeNull()
	})

	it('keeps the picker editable when there are no goals, so a stored value can be cleared', async () => {
		answer({ collection: null, goals: [] })
		mocks.value = 'stale-goal'

		render(<GoalSelectField {...props()} />)

		await screen.findByText(keys.fieldGoalEmpty)
		expect((screen.getByLabelText('goal') as HTMLSelectElement).disabled).toBe(false)
	})

	it('renders the empty notice alongside the configured description', async () => {
		answer({ collection: null, goals: [] })

		render(
			<GoalSelectField
				{...props({
					field: { name: 'goal', type: 'text', label: 'Goal', admin: { description: 'Pick one' } },
				})}
			/>
		)

		await screen.findByText(keys.fieldGoalEmpty)
		expect(screen.getByTestId('description').textContent).toBe('Pick one')
	})

	it('says so when the goals cannot be loaded', async () => {
		fetchMock.mockRejectedValue(new Error('offline'))

		render(<GoalSelectField {...props()} />)

		expect(await screen.findByText(keys.fieldGoalError)).toBeDefined()
		expect(screen.queryByText(keys.fieldGoalEmpty)).toBeNull()
		expect((screen.getByLabelText('goal') as HTMLSelectElement).disabled).toBe(false)
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

		expect(screen.getByTestId('static-description').textContent).toBe('Pick one')
		expect(screen.queryByText(keys.fieldGoalEmpty)).toBeNull()
	})
})
