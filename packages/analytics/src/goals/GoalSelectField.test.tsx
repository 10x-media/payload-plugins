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
	type MockOption = { label: string; value: string }
	type MockGroup = { label: string; options: MockOption[] }
	type MockSelectProps = {
		disabled?: boolean
		onChange?: (option: MockOption) => void
		options: Array<MockOption | MockGroup>
		placeholder?: string
		value?: MockOption | MockOption[]
	}
	const renderOption = (option: MockOption) => (
		<option key={option.value} value={option.value}>
			{option.label}
		</option>
	)
	return {
		FieldDescription: ({ description }: { description?: string }) => (
			<span data-testid="description">{description ?? ''}</span>
		),
		FieldError: () => null,
		FieldLabel: ({ label }: { label?: string }) => <span data-testid="label">{label ?? ''}</span>,
		fieldBaseClass: 'field-type',
		RenderCustomComponent: ({
			CustomComponent,
			Fallback,
		}: {
			CustomComponent?: ReactNode
			Fallback?: ReactNode
		}) => <>{CustomComponent ?? Fallback}</>,
		// A native select draws a group the way react-select does: a heading that is no option.
		ReactSelect: ({ disabled, onChange, options, placeholder, value }: MockSelectProps) => {
			const picked = Array.isArray(value) ? undefined : value
			return (
				<>
					<span data-testid="placeholder">{placeholder ?? ''}</span>
					<span data-testid="picked">{picked?.label ?? ''}</span>
					<select
						aria-label="goal"
						disabled={disabled}
						onChange={(event) =>
							onChange?.({ label: event.target.value, value: event.target.value })
						}
						value={picked?.value ?? ''}
					>
						<option value="">none</option>
						{options.map((entry) =>
							'options' in entry ? (
								<optgroup key={entry.label} label={entry.label}>
									{entry.options.map(renderOption)}
								</optgroup>
							) : (
								renderOption(entry)
							)
						)}
					</select>
				</>
			)
		},
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

	it('fetches the goals endpoint relative to the page, under the configured api route, with credentials', async () => {
		answer({ collection: null, goals: [{ name: 'Signup', slug: 'signup', source: 'config' }] })

		render(<GoalSelectField {...props()} />)

		await screen.findByRole('option', { name: 'Signup' })
		expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/_x/goals')
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

		await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith('book-demo'))
	})

	it('follows the form state path rather than the possibly stale prop', async () => {
		answer({ collection: null, goals: [] })
		mocks.path = 'blocks.0.goal'

		const { container } = render(<GoalSelectField {...props()} />)

		expect(mocks.useFieldArgs[0]).toEqual({ potentiallyStalePath: 'goal' })
		expect(container.querySelector('#field-blocks__0__goal')).not.toBeNull()
	})

	it('derives its style through mergeFieldStyles', () => {
		answer({ collection: null, goals: [] })

		const { container } = render(<GoalSelectField {...props()} />)

		expect(mocks.mergeFieldStyles).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'goal', type: 'text' })
		)
		expect(container.querySelector<HTMLElement>('.field-type')?.style.width).toBe('50%')
	})

	it('carries the field label and the select field classes', () => {
		answer({ collection: null, goals: [] })

		const { container } = render(<GoalSelectField {...props()} />)

		expect(screen.getByTestId('label').textContent).toBe('Goal')
		expect(container.querySelector('.field-type.select.analytics-goal-select')).not.toBeNull()
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

		expect(screen.getByTestId('description').textContent).toBe('Pick one')
		expect(screen.queryByText(keys.fieldGoalEmpty)).toBeNull()
	})
})

describe('grouping by source', () => {
	/** Each heading with the goals under it; options outside any group sit under ''. */
	const listed = () =>
		Array.from(screen.getByLabelText('goal').querySelectorAll('optgroup, select > option')).map(
			(node) =>
				node instanceof HTMLOptGroupElement
					? [node.label, Array.from(node.querySelectorAll('option')).map((o) => o.textContent)]
					: ['', [node.textContent]]
		)

	it('heads the built-in goals and the ones added in the admin when both are present', async () => {
		answer({
			collection: { slug: 'analytics-goals' },
			goals: [
				{ name: 'Newsletter', slug: 'newsletter', source: 'collection' },
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
			],
		})
		render(<GoalSelectField {...props()} />)
		await screen.findByRole('option', { name: 'Book a demo' })
		expect(listed()).toEqual([
			['', ['none']],
			[keys.goalSourceBuiltin, ['Book a demo']],
			[keys.goalSourceCollection, ['Newsletter']],
		])
	})

	// A heading that were an option would take the keyboard's focus and a hover highlight.
	it('makes no option of a heading', async () => {
		answer({
			collection: { slug: 'analytics-goals' },
			goals: [
				{ name: 'Newsletter', slug: 'newsletter', source: 'collection' },
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
			],
		})
		render(<GoalSelectField {...props()} />)
		await screen.findByRole('option', { name: 'Book a demo' })
		expect(screen.queryByRole('option', { name: keys.goalSourceBuiltin })).toBeNull()
		expect(screen.queryByRole('option', { name: keys.goalSourceCollection })).toBeNull()
	})

	// Goals from the plugin's settings and the plugin's own purchase goal are both built in,
	// so they share one heading rather than splitting the list three ways.
	it('lists config goals and the built-in purchase goal under one Built-in heading', async () => {
		answer({
			collection: { slug: 'analytics-goals' },
			goals: [
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
				{ name: 'Purchase', slug: 'purchase', source: 'builtin' },
				{ name: 'Newsletter', slug: 'newsletter', source: 'collection' },
			],
		})
		render(<GoalSelectField {...props()} />)
		await screen.findByRole('option', { name: 'Purchase' })
		expect(listed()).toEqual([
			['', ['none']],
			[keys.goalSourceBuiltin, ['Book a demo', 'Purchase']],
			[keys.goalSourceCollection, ['Newsletter']],
		])
	})

	it('leaves a single-source install as one plain list', async () => {
		answer({
			collection: null,
			goals: [
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
				{ name: 'Signup', slug: 'signup', source: 'config' },
			],
		})
		render(<GoalSelectField {...props()} />)
		await screen.findByRole('option', { name: 'Signup' })
		expect(listed()).toEqual([
			['', ['none']],
			['', ['Book a demo']],
			['', ['Signup']],
		])
	})

	it('shows a stored goal by its name, whichever heading it sits under', async () => {
		answer({
			collection: { slug: 'analytics-goals' },
			goals: [
				{ name: 'Book a demo', slug: 'book-demo', source: 'config' },
				{ name: 'Newsletter', slug: 'newsletter', source: 'collection' },
			],
		})
		mocks.value = 'newsletter'
		render(<GoalSelectField {...props()} />)

		await waitFor(() => expect(screen.getByTestId('picked').textContent).toBe('Newsletter'))
		expect((screen.getByLabelText('goal') as HTMLSelectElement).value).toBe('newsletter')
	})

	it('shows a stored slug no goal answers for as the slug itself, so it can be cleared', async () => {
		answer({ collection: null, goals: [{ name: 'Signup', slug: 'signup', source: 'config' }] })
		mocks.value = 'retired-goal'
		render(<GoalSelectField {...props()} />)

		await screen.findByRole('option', { name: 'Signup' })
		expect(screen.getByTestId('picked').textContent).toBe('retired-goal')
	})
})
