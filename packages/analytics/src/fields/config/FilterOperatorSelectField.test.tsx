import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { TextFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { keys } from '../../translations/keys'
import { FilterOperatorSelectField } from './FilterOperatorSelectField'
import type { SourcesResponse, WireSource } from './fetchSources'

const mocks = vi.hoisted(() => ({
	mergeFieldStyles: vi.fn(() => ({ width: '50%' })),
	path: 'filter.operator',
	setValue: vi.fn(),
	sourceId: undefined as string | undefined,
	useFieldArgs: [] as Array<Record<string, unknown>>,
	userId: 'user-0',
	value: 'eq',
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
					aria-label="operator"
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
		source('alpha', { filterOperators: ['eq'] }),
		source('beta', { filterOperators: ['eq', 'contains', 'matches'] }),
	],
}

const props = (overrides: Record<string, unknown> = {}): TextFieldClientProps =>
	({
		field: { name: 'operator', type: 'text', label: 'Operator' },
		path: 'filter.operator',
		readOnly: false,
		...overrides,
	}) as unknown as TextFieldClientProps

let userSeq = 0

beforeEach(() => {
	userSeq += 1
	// fetchSources caches per user, so each test acts as a different one.
	mocks.userId = `op-user-${userSeq}`
	mocks.path = 'filter.operator'
	mocks.sourceId = undefined
	mocks.value = 'eq'
	mocks.setValue.mockClear()
	mocks.useFieldArgs.length = 0
	fetchMock.mockReset()
	window.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
	cleanup()
})

describe('FilterOperatorSelectField', () => {
	it('is wrapped in withCondition so admin.condition hides it', () => {
		expect(mocks.withCondition).toHaveBeenCalled()
	})

	it('renders through Payload SelectInput, so the row keeps the native 40px chrome', () => {
		answer(twoSources)

		render(<FilterOperatorSelectField {...props()} />)

		expect(screen.getByTestId('wrap').getAttribute('data-control')).toBe('payload-select-input')
	})

	it('offers the union of every source while no source is chosen', async () => {
		answer(twoSources)

		render(<FilterOperatorSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.filterOperatorEq })).toBeDefined()
		expect(screen.getByRole('option', { name: keys.filterOperatorContains })).toBeDefined()
		expect(screen.getByRole('option', { name: keys.filterOperatorMatches })).toBeDefined()
	})

	it('narrows to what the chosen source supports', async () => {
		answer(twoSources)
		mocks.sourceId = 'alpha'

		render(<FilterOperatorSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.filterOperatorEq })).toBeDefined()
		expect(screen.queryByRole('option', { name: keys.filterOperatorContains })).toBeNull()
		expect(screen.queryByRole('option', { name: keys.filterOperatorMatches })).toBeNull()
	})

	it('stores the plain operator when one is picked', async () => {
		answer(twoSources)

		render(<FilterOperatorSelectField {...props()} />)
		const select = (await screen.findByLabelText('operator')) as HTMLSelectElement
		select.value = 'contains'
		select.dispatchEvent(new Event('change', { bubbles: true }))

		await waitFor(() => expect(mocks.setValue).toHaveBeenCalledWith('contains'))
	})

	it('cannot be cleared: an operator always has a value, the dimension is the gate', async () => {
		answer(twoSources)

		render(<FilterOperatorSelectField {...props()} />)

		await screen.findByRole('option', { name: keys.filterOperatorEq })
		expect(screen.getByTestId('wrap').getAttribute('data-clearable')).toBe('false')
	})

	it('keeps a stored operator the chosen source does not support visible', async () => {
		answer(twoSources)
		mocks.sourceId = 'alpha'
		mocks.value = 'matches'

		render(<FilterOperatorSelectField {...props()} />)

		expect(await screen.findByRole('option', { name: keys.filterOperatorMatches })).toBeDefined()
	})

	it('says the source cannot filter when it supports no operator', async () => {
		answer({ defaultId: 'flat', sources: [source('flat', { filterOperators: [] })] })
		mocks.sourceId = 'flat'

		render(<FilterOperatorSelectField {...props()} />)

		expect(await screen.findByText(keys.fieldFilterEmpty)).toBeDefined()
	})

	it('says so when the sources cannot be loaded', async () => {
		fetchMock.mockRejectedValue(new Error('offline'))

		render(<FilterOperatorSelectField {...props()} />)

		expect(await screen.findByText(keys.fieldFilterError)).toBeDefined()
		expect(screen.queryByText(keys.fieldFilterEmpty)).toBeNull()
	})

	it('follows the form state path rather than the possibly stale prop', async () => {
		answer(twoSources)
		mocks.path = 'blocks.0.filter.operator'

		render(<FilterOperatorSelectField {...props()} />)

		expect(mocks.useFieldArgs[0]).toEqual({ potentiallyStalePath: 'filter.operator' })
		expect(screen.getByTestId('path').textContent).toBe('blocks.0.filter.operator')
	})

	it('derives its style through mergeFieldStyles and forwards admin.className', () => {
		answer(twoSources)

		render(
			<FilterOperatorSelectField
				{...props({
					field: {
						name: 'operator',
						type: 'text',
						label: 'Operator',
						admin: { className: 'custom-operator' },
					},
				})}
			/>
		)

		expect(mocks.mergeFieldStyles).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'operator', type: 'text' })
		)
		expect(screen.getByTestId('wrap').getAttribute('data-width')).toBe('50%')
		expect(screen.getByTestId('wrap').getAttribute('data-classname')).toBe('custom-operator')
	})
})
