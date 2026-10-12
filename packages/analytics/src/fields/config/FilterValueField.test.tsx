import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TextFieldClientProps } from 'payload'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SerializedCapabilities } from '../../core/capabilities'
import { DIMENSION_KEYS, FILTER_OPERATORS } from '../../core/contract'
import { keys } from '../../translations/keys'
import { FilterValueField } from './FilterValueField'
import type { WireSource } from './fetchSources'
import { FILTER_HINT_KEYS, FILTER_VALUE_EXAMPLES } from './filterValues'

const mocks = vi.hoisted(() => ({
	dimension: undefined as unknown,
	fetchFilterValues: vi.fn<typeof import('./filterValues').fetchFilterValues>(),
	mergeFieldStyles: vi.fn(() => ({ width: '33.333%' })),
	operator: 'eq' as unknown,
	path: 'filter.value',
	setValue: vi.fn(),
	sourceId: undefined as unknown,
	sources: null as WireSource[] | null,
	/** Payload puts an id on its own input; a custom field wrapping it need not. */
	withInputId: true,
	withCondition: vi.fn((component: unknown) => component),
}))

vi.mock('@payloadcms/ui/shared', () => ({ mergeFieldStyles: mocks.mergeFieldStyles }))

vi.mock('./useAnalyticsSources', () => ({
	useAnalyticsSources: () => ({
		sources: mocks.sources,
		defaultId: null,
		loading: false,
		error: false,
	}),
}))

vi.mock('./filterValues', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./filterValues')>()
	return { ...actual, fetchFilterValues: mocks.fetchFilterValues }
})

vi.mock('@payloadcms/ui', () => {
	type MockTextProps = {
		className?: string
		description?: string
		label?: string
		onChange?: (event: { target: { value: string } }) => void
		path: string
		placeholder?: string
		readOnly?: boolean
		style?: Record<string, string>
		value?: string
		AfterInput?: ReactNode
	}
	return {
		// Mirrors Payload's own text field: the id sits on the input itself.
		TextInput: ({
			className,
			description,
			label,
			onChange,
			path,
			placeholder,
			readOnly,
			style,
			value,
			AfterInput,
		}: MockTextProps) => (
			<div data-classname={className ?? ''} data-testid="wrap" data-width={style?.width ?? ''}>
				<span data-testid="label">{String(label ?? '')}</span>
				<span data-testid="description">{String(description ?? '')}</span>
				<input
					aria-label="value"
					disabled={readOnly}
					{...(mocks.withInputId ? { id: `field-${path.replace(/\./g, '__')}` } : {})}
					onChange={(event) => onChange?.({ target: { value: event.target.value } })}
					placeholder={placeholder}
					value={value ?? ''}
				/>
				{AfterInput}
			</div>
		),
		useAuth: () => ({ user: { id: 'u1' } }),
		useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' } } }),
		useField: () => ({
			customComponents: {},
			disabled: false,
			path: mocks.path,
			setValue: mocks.setValue,
			showError: false,
			value: '',
		}),
		useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) => {
			const group = mocks.path.slice(0, mocks.path.lastIndexOf('.') + 1)
			return selector([
				{
					[`${group}dimension`]: { value: mocks.dimension },
					[`${group}operator`]: { value: mocks.operator },
					dataSource: { value: mocks.sourceId },
				},
			])
		},
		useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
		withCondition: mocks.withCondition,
	}
})

const caps = (over: Partial<SerializedCapabilities> = {}): SerializedCapabilities => ({
	metrics: ['pageviews', 'visitors', 'events', 'conversions'],
	dimensions: [...DIMENSION_KEYS],
	filters: Object.fromEntries(
		DIMENSION_KEYS.map((dimension) => [dimension, [...FILTER_OPERATORS]])
	),
	realtime: false,
	comparison: true,
	minGranularity: 'day',
	maxLookbackDays: null,
	...over,
})

const source = (id: string, over: Partial<SerializedCapabilities> = {}): WireSource => ({
	id,
	label: id,
	kind: 'config',
	capabilities: caps(over),
})

const props = (overrides: Record<string, unknown> = {}): TextFieldClientProps =>
	({
		field: {
			name: 'value',
			type: 'text',
			label: 'Value',
			admin: { description: 'The value to match' },
		},
		path: 'filter.value',
		readOnly: false,
		...overrides,
	}) as unknown as TextFieldClientProps

const input = (): HTMLInputElement => screen.getByLabelText('value') as HTMLInputElement

const listedValues = (): string[] => {
	const list = input().getAttribute('list')
	const datalist = list === null ? null : document.getElementById(list)
	return [...(datalist?.querySelectorAll('option') ?? [])].map((option) => option.value)
}

beforeEach(() => {
	mocks.dimension = undefined
	mocks.operator = 'eq'
	mocks.path = 'filter.value'
	mocks.sourceId = undefined
	mocks.sources = [source('native')]
	mocks.withInputId = true
	mocks.setValue.mockClear()
	mocks.mergeFieldStyles.mockClear()
	mocks.fetchFilterValues.mockReset()
	mocks.fetchFilterValues.mockResolvedValue([])
})

afterEach(() => {
	cleanup()
})

describe('FilterValueField', () => {
	it('is wrapped in withCondition so admin.condition hides it', () => {
		expect(mocks.withCondition).toHaveBeenCalled()
	})

	it('falls back to the configured label and description while no dimension is chosen', () => {
		render(<FilterValueField {...props()} />)

		expect(screen.getByTestId('label').textContent).toBe('Value')
		expect(screen.getByTestId('description').textContent).toBe('The value to match')
		expect(input().getAttribute('placeholder')).toBeNull()
	})

	it('names the dimension it is filtering on', () => {
		mocks.dimension = 'country'
		render(<FilterValueField {...props()} />)

		expect(screen.getByTestId('label').textContent).toBe(keys.viewDimensionCountry)
	})

	it('describes what to type for the dimension, and shows an example of it', () => {
		mocks.dimension = 'page'
		render(<FilterValueField {...props()} />)

		expect(screen.getByTestId('description').textContent).toBe(FILTER_HINT_KEYS.page)
		expect(input().getAttribute('placeholder')).toBe(FILTER_VALUE_EXAMPLES.page)
	})

	it('gives every contract dimension a hint of its own', () => {
		for (const dimension of DIMENSION_KEYS) {
			cleanup()
			mocks.dimension = dimension
			render(<FilterValueField {...props()} />)
			expect(screen.getByTestId('description').textContent).toBe(FILTER_HINT_KEYS[dimension])
		}
	})

	it('offers the dimension its top values as a datalist bound to the input', async () => {
		mocks.dimension = 'country'
		mocks.fetchFilterValues.mockResolvedValue(['DE', 'FR'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(listedValues()).toEqual(['DE', 'FR']))
	})

	// Binding by the id Payload's text field renders would silently lose the combobox wherever a
	// custom field changes or withholds that id.
	it('binds the list without depending on the input carrying an id', async () => {
		mocks.dimension = 'country'
		mocks.withInputId = false
		mocks.fetchFilterValues.mockResolvedValue(['DE', 'FR'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(listedValues()).toEqual(['DE', 'FR']))
	})

	it('reads the suggestions through the dimension and the chosen source', async () => {
		mocks.dimension = 'event'
		mocks.sourceId = 'native'
		mocks.fetchFilterValues.mockResolvedValue(['signup'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(mocks.fetchFilterValues).toHaveBeenCalled())
		expect(mocks.fetchFilterValues.mock.calls[0]?.[0]).toMatchObject({
			endpoint: '/api/_x/query',
			dimension: 'event',
			// Never pageviews: an event row has none of its own.
			metric: 'events',
			source: 'native',
		})
	})

	it('names the suggested value as the view would, and keeps the stored one', async () => {
		mocks.dimension = 'browser'
		mocks.fetchFilterValues.mockResolvedValue(['chrome'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(listedValues()).toEqual(['chrome']))
		const list = input().getAttribute('list') ?? ''
		expect(document.getElementById(list)?.querySelector('option')?.label).toBe(
			keys.valueBrowserChrome
		)
	})

	it('offers nothing while no dimension is chosen', async () => {
		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(mocks.fetchFilterValues).not.toHaveBeenCalled())
		expect(input().getAttribute('list')).toBeNull()
	})

	it('offers nothing for an operator that does not match a whole value', async () => {
		// A fragment of a path is not one of the values a list of whole paths would offer.
		mocks.dimension = 'page'
		mocks.operator = 'contains'
		mocks.fetchFilterValues.mockResolvedValue(['/pricing'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(mocks.fetchFilterValues).not.toHaveBeenCalled())
		expect(input().getAttribute('list')).toBeNull()
	})

	it('leaves a plain input behind when the source cannot rank the dimension', async () => {
		mocks.dimension = 'goal'
		mocks.sourceId = 'thin'
		mocks.sources = [source('thin', { metrics: ['pageviews'] })]

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(mocks.fetchFilterValues).not.toHaveBeenCalled())
		expect(input().getAttribute('list')).toBeNull()
	})

	it('leaves a plain input behind when the read fails', async () => {
		mocks.dimension = 'country'
		mocks.fetchFilterValues.mockRejectedValue(new Error('503'))

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(mocks.fetchFilterValues).toHaveBeenCalled())
		expect(input().getAttribute('list')).toBeNull()
		expect(document.querySelector('datalist')).toBeNull()
	})

	it('ignores an answer that lands after the dimension changed', async () => {
		mocks.dimension = 'country'
		let settle: (values: string[]) => void = () => {}
		mocks.fetchFilterValues.mockReturnValueOnce(
			new Promise<string[]>((resolve) => {
				settle = resolve
			})
		)
		mocks.fetchFilterValues.mockResolvedValue(['signup'])

		const view = render(<FilterValueField {...props()} />)
		mocks.dimension = 'event'
		view.rerender(<FilterValueField {...props()} />)
		settle(['DE', 'FR'])

		await waitFor(() => expect(listedValues()).toEqual(['signup']))
	})

	it('takes the list attribute back off the input when it unmounts', async () => {
		mocks.dimension = 'country'
		mocks.fetchFilterValues.mockResolvedValue(['DE'])

		const view = render(<FilterValueField {...props()} />)
		await waitFor(() => expect(input().getAttribute('list')).not.toBeNull())
		view.unmount()

		expect(document.querySelector('input')).toBeNull()
		expect(document.querySelector('datalist')).toBeNull()
	})

	it('stores what the reader types, suggestion or not', () => {
		mocks.dimension = 'country'
		render(<FilterValueField {...props()} />)

		fireEvent.change(input(), { target: { value: 'PT' } })

		expect(mocks.setValue).toHaveBeenCalledWith('PT')
	})

	it('follows the form state path, so a nested filter group still binds its own list', async () => {
		mocks.dimension = 'country'
		mocks.path = 'blocks.0.filter.value'
		mocks.fetchFilterValues.mockResolvedValue(['DE'])

		render(<FilterValueField {...props()} />)

		await waitFor(() => expect(input().getAttribute('list')).not.toBeNull())
		expect(input().id).toBe('field-blocks__0__filter__value')
	})

	// A row lays out its direct children, so the width belongs on the box the field draws first.
	it('puts the style mergeFieldStyles derives on its own box, and forwards admin.className', () => {
		const { container } = render(
			<FilterValueField
				{...props({
					field: { name: 'value', type: 'text', label: 'Value', admin: { className: 'custom' } },
				})}
			/>
		)

		expect(mocks.mergeFieldStyles).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'value', type: 'text' })
		)
		const box = container.firstElementChild
		expect(box?.className).toBe('analytics-filter-value')
		expect(box instanceof HTMLElement ? box.style.width : '').toBe('33.333%')
		expect(screen.getByTestId('wrap').getAttribute('data-width')).toBe('')
		expect(screen.getByTestId('wrap').getAttribute('data-classname')).toBe('custom')
	})
})
