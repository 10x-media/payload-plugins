import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { CalcExpressionBuilder } from './CalcExpressionBuilder'

const fieldState = vi.hoisted(() => ({
	current: {
		path: 'fields.4.expression',
		value: undefined as unknown,
		setValue: vi.fn(),
	},
}))
const formData = vi.hoisted(() => ({
	current: {
		fields: [
			{ blockType: 'number', name: 'price', label: 'Price' },
			{ blockType: 'number', name: 'qty', label: '' },
			{ blockType: 'text', name: 'notes', label: 'Notes' },
			{
				blockType: 'select',
				name: 'size',
				label: 'Size',
				options: [
					{ label: 'Small', value: 's' },
					{ label: '', value: 'm' },
				],
			},
			{ blockType: 'calculation', name: 'total', label: 'Total' },
			{ blockType: 'calculation', name: 'score', label: 'Score' },
		] as unknown[],
	},
}))

vi.mock('@payloadcms/ui', () => ({
	useField: () => fieldState.current,
	useFormFields: (sel: (arg: [unknown]) => unknown) => sel([{}]),
	FieldLabel: () => null,
	FieldDescription: () => null,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's Button surface
	Button: ({ children, onClick, ...rest }: any) => (
		<button type="button" onClick={onClick} aria-label={rest['aria-label']}>
			{children}
		</button>
	),
	// biome-ignore lint/suspicious/noExplicitAny: test double renders ReactSelect as a native select
	ReactSelect: ({ className, options, value, onChange, placeholder }: any) => (
		<select
			className={className}
			data-placeholder={typeof placeholder === 'string' ? placeholder : undefined}
			value={value?.value ?? ''}
			onChange={(event) => {
				// biome-ignore lint/suspicious/noExplicitAny: test double
				const chosen = options.find((option: any) => String(option.value) === event.target.value)
				onChange(chosen ?? null)
			}}
		>
			<option value="" />
			{/* biome-ignore lint/suspicious/noExplicitAny: test double */}
			{options.map((option: any) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
}))
vi.mock('payload/shared', () => ({ reduceFieldsToValues: () => formData.current }))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const setField = (value: unknown) => {
	const setValue = vi.fn()
	fieldState.current = { path: 'fields.4.expression', value, setValue }
	return setValue
}

const opTree = {
	type: 'op',
	op: '*',
	left: { type: 'ref', field: 'price' },
	right: { type: 'ref', field: 'qty' },
}

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
})

describe('CalcExpressionBuilder', () => {
	it('renders the empty state with a kind picker that seeds the root', () => {
		const setValue = setField(undefined)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderAddExpression)).toBeTruthy()
		const seed = container.querySelector('select.fb-calc-builder__seed') as HTMLSelectElement
		expect(seed).toBeTruthy()
		fireEvent.change(seed, { target: { value: 'op' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'op',
			op: '+',
			left: { type: 'lit', value: 0 },
			right: { type: 'lit', value: 0 },
		})
	})

	it('renders an existing op tree as nested cards', () => {
		setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(container.querySelectorAll('select.fb-calc-node__kind')).toHaveLength(3)
		expect(container.querySelectorAll('select.fb-calc-node__ref')).toHaveLength(2)
		const op = container.querySelector('select.fb-calc-node__op') as HTMLSelectElement
		expect(op.value).toBe('*')
	})

	it('writes an updated AST when a literal is edited', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const input = container.querySelector('input.fb-calc-node__number') as HTMLInputElement
		fireEvent.change(input, { target: { value: '5' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'lit', value: 5 })
	})

	it('seeds the default shape when a node kind is switched', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const kind = container.querySelector('select.fb-calc-node__kind') as HTMLSelectElement
		fireEvent.change(kind, { target: { value: 'ref' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
	})

	it('shows a readable live preview with sibling labels', () => {
		setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const preview = container.querySelector('.fb-calc-builder__preview') as HTMLElement
		expect(preview.getAttribute('aria-live')).toBe('polite')
		expect(preview.textContent).toBe('Price × qty')
	})

	it('rejects invalid JSON with an inline error and applies valid JSON', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		expect(textarea.value).toBe(JSON.stringify({ type: 'lit', value: 2 }, null, 2))

		fireEvent.change(textarea, { target: { value: 'not json' } })
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(screen.getByRole('alert').textContent).toBe(keys.calcBuilderJsonInvalid)
		expect(setValue).not.toHaveBeenCalled()

		fireEvent.change(textarea, { target: { value: '{"type":"nope"}' } })
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(screen.getByRole('alert').textContent).toBe(keys.calcBuilderJsonInvalid)
		expect(setValue).not.toHaveBeenCalled()

		fireEvent.change(textarea, { target: { value: '{"type":"lit","value":7}' } })
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(setValue).toHaveBeenCalledWith({ type: 'lit', value: 7 })
		expect(container.querySelector('textarea')).toBeNull()
	})

	it('offers only numeric-capable siblings, excluding the block being edited', () => {
		setField({ type: 'ref', field: '' })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const ref = container.querySelector('select.fb-calc-node__ref') as HTMLSelectElement
		const values = Array.from(ref.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'price', 'qty', 'score'])
		const labels = Array.from(ref.querySelectorAll('option')).map((option) => option.textContent)
		expect(labels).toEqual(['', 'Price', 'qty', 'Score'])
	})

	it('offers select siblings for the weight node and writes per-option weights', () => {
		setField({ type: 'weight', field: '', weights: {} })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const chooser = first.container.querySelector(
			'select.fb-calc-node__weight-field'
		) as HTMLSelectElement
		const values = Array.from(chooser.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'size'])
		cleanup()

		const setValue = setField({ type: 'weight', field: 'size', weights: { s: 2 } })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText('Small')).toBeTruthy()
		expect(screen.getByText('m')).toBeTruthy()
		const inputs = container.querySelectorAll('input.fb-calc-node__weight')
		expect(inputs).toHaveLength(2)
		fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '3' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'weight',
			field: 'size',
			weights: { s: 2, m: 3 },
		})
	})

	it('adds and removes function arguments, keeping at least one', () => {
		const setValue = setField({ type: 'fn', fn: 'min', args: [{ type: 'lit', value: 1 }] })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.queryByLabelText(keys.calcBuilderRemove)).toBeNull()
		fireEvent.click(screen.getByText(keys.calcBuilderAddArgument))
		expect(setValue).toHaveBeenCalledWith({
			type: 'fn',
			fn: 'min',
			args: [
				{ type: 'lit', value: 1 },
				{ type: 'lit', value: 0 },
			],
		})
		cleanup()

		const setValue2 = setField({
			type: 'fn',
			fn: 'min',
			args: [
				{ type: 'lit', value: 1 },
				{ type: 'lit', value: 2 },
			],
		})
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = screen.getAllByLabelText(keys.calcBuilderRemove)
		expect(removes).toHaveLength(2)
		fireEvent.click(removes[0] as HTMLElement)
		expect(setValue2).toHaveBeenCalledWith({
			type: 'fn',
			fn: 'min',
			args: [{ type: 'lit', value: 2 }],
		})
	})

	it('edits a nested child immutably via its path', () => {
		const setValue = setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const refs = container.querySelectorAll('select.fb-calc-node__ref')
		fireEvent.change(refs[1] as HTMLSelectElement, { target: { value: 'score' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'op',
			op: '*',
			left: { type: 'ref', field: 'price' },
			right: { type: 'ref', field: 'score' },
		})
	})
})
