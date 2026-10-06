import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TextFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { keys } from '../../translations/keys'
import { FilterDimensionSelectField } from './FilterDimensionSelectField'
import type { SourcesResponse, WireSource } from './fetchSources'

const mocks = vi.hoisted(() => ({
	mergeFieldStyles: vi.fn(() => ({ width: '50%' })),
	path: 'filter.dimension',
	setValue: vi.fn(),
	sourceId: undefined as string | undefined,
	useFieldArgs: [] as Array<Record<string, unknown>>,
	userId: 'user-0',
	value: '',
	withCondition: vi.fn((component: unknown) => component),
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: mocks.mergeFieldStyles }))

vi.mock('@payloadcms/ui', () => {
	type MockSelectProps = {
		className?: string
		Description?: ReactNode
		description?: string
		isClearable?: boolean
		label?: string
		name: string
		onChange?: (option: { label: string; value: string }) => void
		options?: Array<{ label: string; value: string }>
		path: string
		readOnly?: boolean
		style?: Record<string, string>
		value?: string
	}
	return {
		FieldDescription: ({ description }: { description?: string }) => (
			<span data-testid="description">{description ?? ''}</span>
		),
		SelectInput: ({
			className,
			Description,
			description,
			isClearable,
			label,
			name,
			onChange,
			options = [],
			path,
			readOnly,
			style,
			value,
		}: MockSelectProps) => (
			<div
				data-clearable={String(isClearable)}
				data-classname={className ?? ''}
				data-control="payload-select-input"
				data-testid="wrap"
				data-width={style?.width ?? ''}
			>
				<span data-testid="label">{label ?? ''}</span>
				<span data-testid="static-description">{description ?? ''}</span>
				<span data-testid="path">{path}</span>
				<select
					aria-label="dimension"
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
		useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
			selector([{ dataSource: { value: mocks.sourceId } }]),
		useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
		withCondition: mocks.withCondition,
	}
})

const caps = (over: Partial<SerializedCapabilities> = {}): SerializedCapabilities => ({
	metrics: ['pageviews'],
	dimensions: ['page'],
	filters: ['page'],
	filterOperators: ['eq'],
	realtime: false,
	perPageQuery: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	...over,
})

const source = (id: string, over: Partial<SerializedCapabilities>): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities: caps(over),
})

const fetchMock = vi.fn()

const answer = (body: SourcesResponse) =>
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
	)

const twoSources: SourcesResponse = {
	defaultId: 'alpha',
	sources: [
		source('alpha', { filters: ['page', 'country'] }),
		source('beta', { filters: ['referrer'] }),
	],
}

const props = (overrides: Record<string, unknown> = {}): TextFieldClientProps =>
	({
		field: { name: 'dimension', type: 'text', label: 'Dimension' },
		path: 'filter.dimension',
		readOnly: false,
		...overrides,
	}) as unknown as TextFieldClientProps

let userSeq = 0

beforeEach(() => {
	userSeq += 1
	// fetchSources caches per user, so each test acts as a different one.
	mocks.userId = `dim-user-${userSeq}`
	mocks.path = 'filter.dimension'
	mocks.sourceId = undefined
	mocks.value = ''
	mocks.setValue.mockClear()
	mocks.useFieldArgs.length = 0
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	cleanup()
})

describe('FilterDimensionSelectField', () => {
	it('is wrapped in withCondition so admin.condition hides it', () => {
		expect(mocks.withCondition).toHaveBeenCalled()
	})

	it('renders through Payload SelectInput, so the row keeps the native 40px chrome', () => {
		answer(twoSources)

		render(<FilterDimensionSelectField {...props()} />)

		expect(screen.getByTestId('wrap').getAttribute('data-control')).toBe('payload-select-input')
	})

	it('offers the union of every source while no source is chosen', async () => {
		answer(twoSources)

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.viewDimensionPage })).toBeDefined()
		expect(screen.getByRole('option', { name: keys.viewDimensionCountry })).toBeDefined()
		expect(screen.getByRole('option', { name: keys.viewDimensionReferrer })).toBeDefined()
	})

	it('narrows to what the chosen source can filter', async () => {
		answer(twoSources)
		mocks.sourceId = 'beta'

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.viewDimensionReferrer })).toBeDefined()
		expect(screen.queryByRole('option', { name: keys.viewDimensionCountry })).toBeNull()
	})

	it('stores the plain dimension key when one is picked', async () => {
		answer(twoSources)

		render(<FilterDimensionSelectField {...props()} />)
		const select = (await screen.findByLabelText('dimension')) as HTMLSelectElement
		select.value = 'country'
		select.dispatchEvent(new Event('change', { bubbles: true }))

		await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith('country'))
	})

	it('clears to null when the picker is emptied', async () => {
		answer(twoSources)
		mocks.value = 'country'

		render(<FilterDimensionSelectField {...props()} />)
		const select = (await screen.findByLabelText('dimension')) as HTMLSelectElement
		select.value = ''
		select.dispatchEvent(new Event('change', { bubbles: true }))

		await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith(null))
	})

	it('keeps a stored dimension the chosen source cannot filter visible and clearable', async () => {
		answer(twoSources)
		mocks.sourceId = 'beta'
		mocks.value = 'country'

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.viewDimensionCountry })).toBeDefined()
		expect((screen.getByLabelText('dimension') as HTMLSelectElement).disabled).toBe(false)
		expect(screen.getByTestId('wrap').getAttribute('data-clearable')).toBe('true')
	})

	it('shows a stored value that is not a contract dimension at all', async () => {
		answer(twoSources)
		mocks.value = 'not-a-dimension'

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: 'not-a-dimension' })).toBeDefined()
	})

	it('says the source cannot filter when it offers no dimensions', async () => {
		answer({ defaultId: 'flat', sources: [source('flat', { filters: [] })] })
		mocks.sourceId = 'flat'

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByText(keys.fieldFilterEmpty)).toBeDefined()
	})

	it('stays quiet about the empty list while the sources are still loading', () => {
		answer(twoSources)

		render(<FilterDimensionSelectField {...props()} />)

		expect(screen.queryByText(keys.fieldFilterEmpty)).toBeNull()
		expect(screen.queryByText(keys.fieldFilterError)).toBeNull()
	})

	it('says so when the sources cannot be loaded', async () => {
		fetchMock.mockRejectedValue(new Error('offline'))

		render(<FilterDimensionSelectField {...props()} />)

		expect(await screen.findByText(keys.fieldFilterError)).toBeDefined()
		expect(screen.queryByText(keys.fieldFilterEmpty)).toBeNull()
	})

	it('stays quiet while there is no user to fetch the sources for', () => {
		answer(twoSources)
		mocks.userId = ''

		render(<FilterDimensionSelectField {...props()} />)

		expect(screen.queryByText(keys.fieldFilterEmpty)).toBeNull()
		expect(screen.queryByText(keys.fieldFilterError)).toBeNull()
	})

	it('renders a notice alongside the configured description rather than in place of it', async () => {
		answer({ defaultId: 'flat', sources: [source('flat', { filters: [] })] })
		mocks.sourceId = 'flat'

		render(
			<FilterDimensionSelectField
				{...props({
					field: {
						name: 'dimension',
						type: 'text',
						label: 'Dimension',
						admin: { description: 'Pick one' },
					},
				})}
			/>
		)

		await screen.findByText(keys.fieldFilterEmpty)
		expect(screen.getByTestId('description').textContent).toBe('Pick one')
	})

	it('follows the form state path rather than the possibly stale prop', async () => {
		answer(twoSources)
		mocks.path = 'blocks.0.filter.dimension'

		render(<FilterDimensionSelectField {...props()} />)

		expect(mocks.useFieldArgs[0]).toEqual({ potentiallyStalePath: 'filter.dimension' })
		expect(screen.getByTestId('path').textContent).toBe('blocks.0.filter.dimension')
	})

	it('derives its style through mergeFieldStyles and forwards admin.className', () => {
		answer(twoSources)

		render(
			<FilterDimensionSelectField
				{...props({
					field: {
						name: 'dimension',
						type: 'text',
						label: 'Dimension',
						admin: { className: 'custom-dimension' },
					},
				})}
			/>
		)

		expect(mocks.mergeFieldStyles).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'dimension', type: 'text' })
		)
		expect(screen.getByTestId('wrap').getAttribute('data-width')).toBe('50%')
		expect(screen.getByTestId('wrap').getAttribute('data-classname')).toBe('custom-dimension')
	})

	it('fetches the sources endpoint with credentials', async () => {
		answer(twoSources)

		render(<FilterDimensionSelectField {...props()} />)

		await screen.findByRole('option', { name: keys.viewDimensionPage })
		expect(fetchMock.mock.calls[0]?.[0]).toBe('https://cms.test/api/analytics/sources')
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit)?.credentials).toBe('include')
	})
})
