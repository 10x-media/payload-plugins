import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '../translations/keys'
import { CalcExpressionBuilder } from './CalcExpressionBuilder'

const fieldState = vi.hoisted(() => ({
	current: {
		path: 'fields.4.expression',
		value: undefined as unknown,
		setValue: vi.fn(),
		disabled: false,
		showError: false,
		customComponents: {},
	},
}))
const baseFields = vi.hoisted(() => [
	{ blockType: 'number', name: 'price', label: 'Price' },
	{ blockType: 'number', name: 'qty', label: '' },
	{ blockType: 'calculation', name: 'score', label: 'Score' },
	{ blockType: 'text', name: 'notes', label: 'Notes' },
	{ blockType: 'calculation', name: 'total', label: 'Total' },
	{
		blockType: 'select',
		name: 'size',
		label: 'Size',
		options: [
			{ label: 'Small', value: 's' },
			{ label: '', value: 'm' },
		],
	},
	{ blockType: 'select', name: 'color', label: 'Color', options: [{ label: 'Red', value: 'red' }] },
	{ blockType: 'calculation', name: 'late', label: 'Late' },
])
const formData = vi.hoisted(() => ({ current: { fields: [] as unknown[] } }))

vi.mock('@payloadcms/ui', () => ({
	useField: () => fieldState.current,
	useFormFields: (sel: (arg: [unknown]) => unknown) => sel([{}]),
	FieldLabel: () => null,
	FieldError: () => null,
	FieldDescription: () => null,
	RenderCustomComponent: ({ Fallback }: { Fallback: ReactNode }) => Fallback,
	// biome-ignore lint/suspicious/noExplicitAny: test double over Payload's Button surface
	Button: ({ children, onClick, disabled, ...rest }: any) => (
		<button type="button" onClick={onClick} disabled={disabled} aria-label={rest['aria-label']}>
			{children}
		</button>
	),
	ReactSelect: ({
		className,
		options,
		value,
		onChange,
		placeholder,
		disabled,
		inputId,
		isClearable,
		// biome-ignore lint/suspicious/noExplicitAny: test double
	}: any) => (
		<select
			id={inputId}
			className={className}
			disabled={disabled}
			data-clearable={isClearable ? 'true' : 'false'}
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

const setField = (value: unknown, overrides: Partial<typeof fieldState.current> = {}) => {
	fieldState.current = {
		path: 'fields.4.expression',
		value,
		setValue: vi.fn(),
		disabled: false,
		showError: false,
		customComponents: {},
		...overrides,
	}
	return fieldState.current.setValue
}

const opTree = {
	type: 'op',
	op: '*',
	left: { type: 'ref', field: 'price' },
	right: { type: 'ref', field: 'qty' },
}

formData.current = { fields: baseFields }

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	formData.current = { fields: baseFields }
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

	it('renders an existing neg node with a Negate kind option and its operand card', () => {
		setField({ type: 'neg', operand: { type: 'lit', value: 3 } })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const kinds = container.querySelectorAll('select.fb-calc-node__kind')
		expect(kinds).toHaveLength(2)
		const rootKind = kinds[0] as HTMLSelectElement
		expect(rootKind.value).toBe('neg')
		expect(screen.getByText(keys.calcBuilderNegate)).toBeTruthy()
		expect(container.querySelector('input.fb-calc-node__number')).toBeTruthy()
	})

	it('writes an updated AST when a literal is edited', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const input = container.querySelector('input.fb-calc-node__number') as HTMLInputElement
		fireEvent.change(input, { target: { value: '5' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'lit', value: 5 })
	})

	it('reverts an uncommitted invalid draft on blur', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const input = container.querySelector('input.fb-calc-node__number') as HTMLInputElement
		fireEvent.change(input, { target: { value: '' } })
		expect(setValue).not.toHaveBeenCalled()
		fireEvent.blur(input)
		expect(input.value).toBe('2')
	})

	it('replaces destructively when switching to a leaf kind', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const kind = container.querySelector('select.fb-calc-node__kind') as HTMLSelectElement
		fireEvent.change(kind, { target: { value: 'ref' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
	})

	it('promotes the current node when switching to Math or Function', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.change(first.container.querySelector('select.fb-calc-node__kind') as HTMLElement, {
			target: { value: 'op' },
		})
		expect(setValue).toHaveBeenCalledWith({
			type: 'op',
			op: '+',
			left: { type: 'lit', value: 2 },
			right: { type: 'lit', value: 0 },
		})
		cleanup()

		const setValue2 = setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.change(container.querySelector('select.fb-calc-node__kind') as HTMLElement, {
			target: { value: 'fn' },
		})
		expect(setValue2).toHaveBeenCalledWith({ type: 'fn', fn: 'round', args: [opTree] })
	})

	it('shows a readable live preview with sibling labels, mounted even when empty', () => {
		setField(opTree)
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const preview = first.container.querySelector('.fb-calc-builder__preview') as HTMLElement
		expect(preview.getAttribute('aria-live')).toBe('polite')
		expect(preview.textContent).toBe('Price × qty')
		cleanup()

		setField(undefined)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const empty = container.querySelector('.fb-calc-builder__preview') as HTMLElement
		expect(empty).toBeTruthy()
		expect(empty.textContent).toBe('')
	})

	it('rejects invalid JSON with an inline error and applies valid JSON', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		expect(textarea.value).toBe(JSON.stringify({ type: 'lit', value: 2 }, null, 2))

		fireEvent.change(textarea, { target: { value: 'not json' } })
		expect(screen.getByRole('alert').textContent).toBe(keys.calcBuilderJsonInvalid)
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(container.querySelector('textarea')).toBeTruthy()
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

	it('live-commits a valid JSON draft without toggling back', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		fireEvent.change(textarea, { target: { value: '{"type":"lit","value":9}' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'lit', value: 9 })
		expect(screen.queryByRole('alert')).toBeNull()
		expect(container.querySelector('textarea')).toBeTruthy()
	})

	it('does not write when toggling back with no edits', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(setValue).not.toHaveBeenCalled()
	})

	it('clears the expression when applying an explicit null', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		fireEvent.change(textarea, { target: { value: 'null' } })
		expect(screen.queryByRole('alert')).toBeNull()
		expect(setValue).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText(keys.calcBuilderVisualMode))
		expect(setValue).toHaveBeenCalledWith(null)
		expect(container.querySelector('textarea')).toBeNull()
	})

	it('seeds the JSON draft from the current expression when the value arrives after first render', () => {
		setField(undefined)
		const { container, rerender } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} />
		)
		fieldState.current = { ...fieldState.current, value: opTree }
		rerender(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		expect(textarea.value).toBe(JSON.stringify(opTree, null, 2))
	})

	it('keeps the JSON textarea in sync when the value arrives while JSON mode is open', () => {
		setField(undefined)
		const { container, rerender } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} />
		)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		fieldState.current = { ...fieldState.current, value: opTree }
		rerender(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		expect(textarea.value).toBe(JSON.stringify(opTree, null, 2))
	})

	it('gives the JSON textarea an accessible name', () => {
		setField({ type: 'lit', value: 2 })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = screen.getByLabelText(keys.calcBuilderJsonLabel) as HTMLTextAreaElement
		expect(textarea.tagName).toBe('TEXTAREA')
	})

	it('seeds the JSON draft from the raw value when it fails normalization', () => {
		setField({ type: 'bogus', anything: 1 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByText(keys.calcBuilderJsonMode))
		const textarea = container.querySelector('textarea') as HTMLTextAreaElement
		expect(textarea.value).toContain('"bogus"')
	})

	it('offers only backward-referenceable numeric siblings, excluding self and later calculations', () => {
		setField({ type: 'ref', field: '' })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const ref = container.querySelector('select.fb-calc-node__ref') as HTMLSelectElement
		const values = Array.from(ref.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'price', 'qty', 'score'])
		const labels = Array.from(ref.querySelectorAll('option')).map((option) => option.textContent)
		expect(labels).toEqual(['', 'Price', 'qty', 'Score'])
	})

	it('hints instead of rendering empty pickers when no eligible siblings exist', () => {
		formData.current = { fields: [] }
		setField({ type: 'ref', field: '' })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderNoNumericFields)).toBeTruthy()
		expect(first.container.querySelector('select.fb-calc-node__ref')).toBeNull()
		cleanup()

		setField({ type: 'weight', field: '', weights: {} })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderNoChoiceFields)).toBeTruthy()
		expect(container.querySelector('select.fb-calc-node__weight-field')).toBeNull()
	})

	it('offers select siblings for the weight node and writes per-option weights', () => {
		setField({ type: 'weight', field: '', weights: {} })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const chooser = first.container.querySelector(
			'select.fb-calc-node__weight-field'
		) as HTMLSelectElement
		const values = Array.from(chooser.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'size', 'color'])
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

	it('resets weights when the weight source field changes', () => {
		const setValue = setField({ type: 'weight', field: 'size', weights: { s: 2 } })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const chooser = container.querySelector('select.fb-calc-node__weight-field') as HTMLElement
		fireEvent.change(chooser, { target: { value: 'color' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'weight', field: 'color', weights: {} })
	})

	it('adds and removes function arguments, keeping at least one', () => {
		const setValue = setField({ type: 'fn', fn: 'min', args: [{ type: 'lit', value: 1 }] })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(first.container.querySelector('.fb-calc-node__arg-remove')).toBeNull()
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
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = container.querySelectorAll('.fb-calc-node__arg-remove button')
		expect(removes).toHaveLength(2)
		fireEvent.click(removes[0] as HTMLElement)
		expect(setValue2).toHaveBeenCalledWith({
			type: 'fn',
			fn: 'min',
			args: [{ type: 'lit', value: 2 }],
		})
	})

	it('offers clearable field pickers that reset the reference', () => {
		const setValue = setField({ type: 'ref', field: 'price' })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const ref = first.container.querySelector('select.fb-calc-node__ref') as HTMLSelectElement
		expect(ref.getAttribute('data-clearable')).toBe('true')
		const kind = first.container.querySelector('select.fb-calc-node__kind') as HTMLSelectElement
		expect(kind.getAttribute('data-clearable')).toBe('false')
		fireEvent.change(ref, { target: { value: '' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
		cleanup()

		const setValue2 = setField({ type: 'weight', field: 'size', weights: { s: 2 } })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const chooser = container.querySelector(
			'select.fb-calc-node__weight-field'
		) as HTMLSelectElement
		expect(chooser.getAttribute('data-clearable')).toBe('true')
		fireEvent.change(chooser, { target: { value: '' } })
		expect(setValue2).toHaveBeenCalledWith({ type: 'weight', field: '', weights: {} })
	})

	it('unwraps a container node to its first child, preserving the subtree', () => {
		const setValue = setField(opTree)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByLabelText(keys.calcBuilderUnwrap))
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: 'price' })
	})

	it('clears the whole expression when removing a root leaf', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByLabelText(keys.calcBuilderRemove))
		expect(setValue).toHaveBeenCalledWith(null)
	})

	it('reseeds a nested leaf to Number 0 on remove', () => {
		const setValue = setField(opTree)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = screen.getAllByLabelText(keys.calcBuilderRemove)
		expect(removes).toHaveLength(2)
		fireEvent.click(removes[0] as HTMLElement)
		expect(setValue).toHaveBeenCalledWith({
			type: 'op',
			op: '*',
			left: { type: 'lit', value: 0 },
			right: { type: 'ref', field: 'qty' },
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

	it('disables every control and blocks writes when readOnly', () => {
		const setValue = setField(opTree)
		const { container } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} readOnly />
		)
		const root = container.querySelector('.field-type') as HTMLElement
		expect(root.classList.contains('read-only')).toBe(true)
		const selects = Array.from(container.querySelectorAll('select'))
		expect(selects.length).toBeGreaterThan(0)
		for (const select of selects) {
			expect((select as HTMLSelectElement).disabled).toBe(true)
		}
		for (const button of Array.from(container.querySelectorAll('button'))) {
			expect((button as HTMLButtonElement).disabled).toBe(true)
		}
		const kind = container.querySelector('select.fb-calc-node__kind') as HTMLElement
		fireEvent.change(kind, { target: { value: 'lit' } })
		expect(setValue).not.toHaveBeenCalled()
	})

	it('marks the root with the error class when the field shows an error', () => {
		setField({ type: 'lit', value: 2 }, { showError: true })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const root = container.querySelector('.field-type') as HTMLElement
		expect(root.classList.contains('error')).toBe(true)
	})
})
