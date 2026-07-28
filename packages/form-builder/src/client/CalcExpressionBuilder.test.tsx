import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateCalc } from '../calc/evaluate'
import type { CalcExpression } from '../calc/types'
import { de } from '../translations/de'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { astToChain, CalcExpressionBuilder, chainToAst } from './CalcExpressionBuilder'

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
		// biome-ignore lint/suspicious/noExplicitAny: test double renders ReactSelect as a native select
	}: any) => (
		<select
			id={inputId}
			className={className}
			disabled={disabled}
			data-clearable={isClearable ? 'true' : 'false'}
			data-placeholder={typeof placeholder === 'string' ? placeholder : undefined}
			value={value?.value ?? ''}
			onChange={(event) => {
				const flat = options.flatMap(
					// biome-ignore lint/suspicious/noExplicitAny: test double
					(option: any) => (option.options ? option.options : [option])
				)
				// biome-ignore lint/suspicious/noExplicitAny: test double
				const chosen = flat.find((option: any) => String(option.value) === event.target.value)
				onChange(chosen ?? null)
			}}
		>
			<option value="" />
			{/* biome-ignore lint/suspicious/noExplicitAny: test double */}
			{options.map((option: any) =>
				option.options ? (
					<optgroup key={option.label} label={option.label}>
						{/* biome-ignore lint/suspicious/noExplicitAny: test double */}
						{option.options.map((grouped: any) => (
							<option key={grouped.value} value={grouped.value}>
								{grouped.label}
							</option>
						))}
					</optgroup>
				) : (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				)
			)}
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

const rightNested: CalcExpression = {
	type: 'op',
	op: '+',
	left: { type: 'ref', field: 'price' },
	right: {
		type: 'op',
		op: '*',
		left: { type: 'ref', field: 'qty' },
		right: { type: 'lit', value: 2 },
	},
}

const quoteSubtotal: CalcExpression = {
	type: 'op',
	op: '*',
	left: { type: 'ref', field: 'hours' },
	right: { type: 'ref', field: 'rate' },
}
const quoteSurcharge: CalcExpression = {
	type: 'weight',
	field: 'priority',
	weights: { standard: 0, rush: 250 },
}
const quoteTotal: CalcExpression = {
	type: 'fn',
	fn: 'round',
	args: [
		{
			type: 'op',
			op: '*',
			left: {
				type: 'op',
				op: '+',
				left: { type: 'ref', field: 'subtotal' },
				right: { type: 'ref', field: 'surcharge' },
			},
			right: { type: 'lit', value: 1.19 },
		},
	],
}

formData.current = { fields: baseFields }

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	formData.current = { fields: baseFields }
})

describe('chain mapping', () => {
	it('round-trips the Project Quote expressions structurally', () => {
		for (const expr of [quoteSubtotal, quoteSurcharge, quoteTotal]) {
			expect(chainToAst(astToChain(expr))).toEqual(expr)
		}
	})

	it('round-trips a right-nested tree structurally and evaluation-equivalently', () => {
		const roundTripped = chainToAst(astToChain(rightNested))
		expect(roundTripped).toEqual(rightNested)
		for (const answers of [
			{ price: 3, qty: 4 },
			{ price: 0, qty: 7 },
			{ price: -2.5, qty: 1.5 },
		]) {
			expect(evaluateCalc(roundTripped, answers)).toBe(evaluateCalc(rightNested, answers))
		}
	})

	it('round-trips adversarial shapes structurally', () => {
		const negInRight: CalcExpression = {
			type: 'op',
			op: '-',
			left: { type: 'ref', field: 'price' },
			right: { type: 'neg', operand: { type: 'ref', field: 'qty' } },
		}
		const roundTwoArgs: CalcExpression = {
			type: 'fn',
			fn: 'round',
			args: [
				{ type: 'lit', value: 1 },
				{ type: 'lit', value: 2 },
			],
		}
		const fnWithNestedArg: CalcExpression = {
			type: 'fn',
			fn: 'max',
			args: [rightNested, { type: 'lit', value: 0 }],
		}
		for (const expr of [negInRight, roundTwoArgs, fnWithNestedArg]) {
			expect(chainToAst(astToChain(expr))).toEqual(expr)
		}
		// A 2-arg round is not unary application; it must stay an fn operand, never a finisher.
		expect(astToChain(roundTwoArgs).finish).toBeUndefined()
		expect(astToChain(roundTwoArgs).first.kind).toBe('fn')
	})

	it('loads a wrapping unary fn as finish but keeps variadic fns as operands', () => {
		const wrapped = astToChain(quoteTotal)
		expect(wrapped.finish).toBe('round')
		expect(wrapped.steps).toHaveLength(2)

		const minWrapped: CalcExpression = { type: 'fn', fn: 'min', args: [quoteSubtotal] }
		const minChain = astToChain(minWrapped)
		expect(minChain.finish).toBeUndefined()
		expect(minChain.first.kind).toBe('fn')
		expect(chainToAst(minChain)).toEqual(minWrapped)
	})
})

describe('CalcExpressionBuilder', () => {
	it('renders the empty state with a Start with picker and kind descriptions', () => {
		const setValue = setField(undefined)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderAddExpression)).toBeTruthy()
		expect(screen.getByText(keys.calcBuilderFieldDescription)).toBeTruthy()
		expect(screen.getByText(keys.calcBuilderNumberDescription)).toBeTruthy()
		expect(screen.getByText(keys.calcBuilderWeightsDescription)).toBeTruthy()
		expect(screen.getByText(keys.calcBuilderFunctionDescription)).toBeTruthy()
		const seed = screen.getByLabelText(keys.calcBuilderStartWith) as HTMLSelectElement
		expect(seed.classList.contains('fb-calc-builder__seed')).toBe(true)
		const values = Array.from(seed.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'ref', 'lit', 'weight', 'fn'])
		fireEvent.change(seed, { target: { value: 'ref' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
		fireEvent.change(seed, { target: { value: 'fn' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'fn',
			fn: 'min',
			args: [{ type: 'lit', value: 0 }],
		})
		expect(container.querySelector('.fb-calc-chain')).toBeNull()
	})

	it('builds price times qty left-to-right via Add step', () => {
		const setValue = setField({ type: 'ref', field: 'price' })
		const { container, rerender } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} />
		)
		fireEvent.click(screen.getByText(keys.calcBuilderAddStep))
		const afterAdd = {
			type: 'op',
			op: '*',
			left: { type: 'ref', field: 'price' },
			right: { type: 'ref', field: '' },
		}
		expect(setValue).toHaveBeenCalledWith(afterAdd)

		fieldState.current = { ...fieldState.current, value: afterAdd }
		rerender(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const refs = container.querySelectorAll('select.fb-calc-operand__ref')
		expect(refs).toHaveLength(2)
		fireEvent.change(refs[1] as HTMLSelectElement, { target: { value: 'qty' } })
		expect(setValue).toHaveBeenCalledWith(opTree)
	})

	it('loads a left-leaning op tree as chain rows', () => {
		setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(container.querySelectorAll('.fb-calc-chain > .fb-calc-row')).toHaveLength(2)
		expect(container.querySelectorAll('select.fb-calc-operand__ref')).toHaveLength(2)
		const op = container.querySelector('select.fb-calc-row__op') as HTMLSelectElement
		expect(op.value).toBe('*')
	})

	it('reserves the op column on the first row and divides later rows', () => {
		setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const rows = container.querySelectorAll('.fb-calc-chain > .fb-calc-row')
		expect(rows).toHaveLength(2)
		expect(rows[0]?.querySelector('.fb-calc-row__op-spacer')).toBeTruthy()
		expect(rows[0]?.querySelector('.fb-calc-row__op')).toBeNull()
		expect((rows[0] as HTMLElement).classList.contains('fb-calc-row--divided')).toBe(false)
		expect(rows[1]?.querySelector('.fb-calc-row__op-spacer')).toBeNull()
		expect((rows[1] as HTMLElement).classList.contains('fb-calc-row--divided')).toBe(true)
	})

	it('places the Then apply wording in the op column of the finisher row', () => {
		setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const finish = container.querySelector('.fb-calc-finish') as HTMLElement
		expect(finish.querySelector('.fb-calc-row__op-spacer')).toBeNull()
		const finishLabel = finish.firstElementChild as HTMLElement
		expect(finishLabel.classList.contains('fb-calc-finish__label')).toBe(true)
		expect(finishLabel.textContent).toBe(keys.calcBuilderThenApply)
		expect(finishLabel.getAttribute('title')).toBe(keys.calcBuilderThenApply)
		expect(finishLabel.nextElementSibling?.classList.contains('fb-calc-finish__select')).toBe(true)
	})

	it('loads a right-nested tree with a Group operand', () => {
		setField(rightNested)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderGroup)).toBeTruthy()
		expect(container.querySelector('.fb-calc-operand--group')).toBeTruthy()
		const ops = Array.from(container.querySelectorAll('select.fb-calc-row__op')).map(
			(select) => (select as HTMLSelectElement).value
		)
		expect(ops).toEqual(['+', '*'])
	})

	it('loads and saves the Then apply finisher', () => {
		const setValue = setField(quoteTotal)
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const finish = first.container.querySelector(
			'select.fb-calc-finish__select'
		) as HTMLSelectElement
		expect(finish.value).toBe('round')
		const values = Array.from(finish.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'round', 'abs', 'ceil', 'floor'])
		fireEvent.change(finish, { target: { value: '' } })
		expect(setValue).toHaveBeenCalledWith(quoteTotal.type === 'fn' ? quoteTotal.args[0] : null)
		cleanup()

		const setValue2 = setField(opTree)
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.change(container.querySelector('select.fb-calc-finish__select') as HTMLElement, {
			target: { value: 'ceil' },
		})
		expect(setValue2).toHaveBeenCalledWith({ type: 'fn', fn: 'ceil', args: [opTree] })
	})

	it('promotes the next row when the first row is removed', () => {
		const setValue = setField(opTree)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = screen.getAllByLabelText(keys.calcBuilderRemove)
		expect(removes).toHaveLength(2)
		fireEvent.click(removes[0] as HTMLElement)
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: 'qty' })
	})

	it('drops a step row on remove', () => {
		const setValue = setField(opTree)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = screen.getAllByLabelText(keys.calcBuilderRemove)
		fireEvent.click(removes[1] as HTMLElement)
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: 'price' })
	})

	it('clears the expression when the only row is removed at the root', () => {
		const setValue = setField({ type: 'ref', field: 'price' })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		fireEvent.click(screen.getByLabelText(keys.calcBuilderRemove))
		expect(setValue).toHaveBeenCalledWith(null)
	})

	it('hides the row remove on a nested chain with only one row', () => {
		const setValue = setField({ type: 'fn', fn: 'min', args: [{ type: 'lit', value: 5 }] })
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const removes = screen.getAllByLabelText(keys.calcBuilderRemove)
		expect(removes).toHaveLength(1)
		fireEvent.click(removes[0] as HTMLElement)
		expect(setValue).toHaveBeenCalledWith(null)
	})

	it('keeps row removes inside a nested chain that has multiple rows', () => {
		setField({
			type: 'fn',
			fn: 'min',
			args: [
				{
					type: 'op',
					op: '+',
					left: { type: 'ref', field: 'price' },
					right: { type: 'ref', field: 'qty' },
				},
			],
		})
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getAllByLabelText(keys.calcBuilderRemove)).toHaveLength(3)
	})

	it('adds and removes function arguments, keeping at least one', () => {
		const setValue = setField({ type: 'fn', fn: 'min', args: [{ type: 'lit', value: 1 }] })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(first.container.querySelector('.fb-calc-fn__arg-remove')).toBeNull()
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
		const argRemoves = container.querySelectorAll('.fb-calc-fn__arg-remove button')
		expect(argRemoves).toHaveLength(2)
		fireEvent.click(argRemoves[0] as HTMLElement)
		expect(setValue2).toHaveBeenCalledWith({
			type: 'fn',
			fn: 'min',
			args: [{ type: 'lit', value: 2 }],
		})
	})

	it('switches a leaf operand kind in place, offering only leaf kinds', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const kind = container.querySelector('select.fb-calc-operand__kind') as HTMLSelectElement
		const values = Array.from(kind.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'ref', 'lit', 'weight'])
		fireEvent.change(kind, { target: { value: 'ref' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
	})

	it('renders a neg operand with its Negate card', () => {
		setField({ type: 'neg', operand: { type: 'lit', value: 3 } })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderNegate)).toBeTruthy()
		expect(container.querySelector('.fb-calc-operand--neg')).toBeTruthy()
		expect(container.querySelector('input.fb-calc-operand__number')).toBeTruthy()
	})

	it('writes an updated AST when a literal is edited and reverts invalid drafts on blur', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const input = container.querySelector('input.fb-calc-operand__number') as HTMLInputElement
		fireEvent.change(input, { target: { value: '5' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'lit', value: 5 })
		fireEvent.change(input, { target: { value: '' } })
		fireEvent.blur(input)
		// The harness's setValue is a mock, so the committed prop value is still 2; blur reverts to it.
		expect(input.value).toBe('2')
	})

	it('offers only backward-referenceable numeric siblings with a clearable picker', () => {
		const setValue = setField({ type: 'ref', field: 'price' })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const ref = container.querySelector('select.fb-calc-operand__ref') as HTMLSelectElement
		const values = Array.from(ref.querySelectorAll('option')).map((option) => option.value)
		expect(values).toEqual(['', 'price', 'qty', 'score'])
		const labels = Array.from(ref.querySelectorAll('option')).map((option) => option.textContent)
		expect(labels).toEqual(['', 'Price', 'qty', 'Score'])
		expect(ref.getAttribute('data-clearable')).toBe('true')
		fireEvent.change(ref, { target: { value: '' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'ref', field: '' })
	})

	it('edits weighted fields: per-option weights, source switch reset, clearable source', () => {
		const setValue = setField({ type: 'weight', field: 'size', weights: { s: 2 } })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText('Small')).toBeTruthy()
		expect(screen.getByText('m')).toBeTruthy()
		const inputs = first.container.querySelectorAll('input.fb-calc-operand__weight')
		expect(inputs).toHaveLength(2)
		fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: '3' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'weight',
			field: 'size',
			weights: { s: 2, m: 3 },
		})
		const chooser = first.container.querySelector(
			'select.fb-calc-operand__weight-field'
		) as HTMLSelectElement
		expect(chooser.getAttribute('data-clearable')).toBe('true')
		fireEvent.change(chooser, { target: { value: 'color' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'weight', field: 'color', weights: {} })
	})

	it('hints instead of rendering empty pickers when no eligible siblings exist', () => {
		formData.current = { fields: [] }
		setField({ type: 'ref', field: '' })
		const first = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderNoNumericFields)).toBeTruthy()
		expect(first.container.querySelector('select.fb-calc-operand__ref')).toBeNull()
		cleanup()

		setField({ type: 'weight', field: '', weights: {} })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderNoChoiceFields)).toBeTruthy()
		expect(container.querySelector('select.fb-calc-operand__weight-field')).toBeNull()
	})

	it('names every chain select for assistive tech', () => {
		setField(rightNested)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getAllByLabelText(keys.calcBuilderMath).length).toBeGreaterThan(0)
		expect(screen.getAllByLabelText(keys.calcBuilderKind).length).toBeGreaterThan(0)
		expect(screen.getAllByLabelText(keys.calcBuilderPickField).length).toBeGreaterThan(0)
		expect(screen.getByLabelText(keys.calcBuilderThenApply)).toBeTruthy()
	})

	it('renames Weighted answers to Weighted field in both locales', () => {
		expect(en[keys.calcBuilderWeights]).toBe('Weighted field')
		expect(de[keys.calcBuilderWeights]).toBe('Gewichtetes Feld')
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

	it('previews unfilled slots as a question mark', () => {
		setField({
			type: 'op',
			op: '*',
			left: { type: 'ref', field: 'price' },
			right: { type: 'ref', field: '' },
		})
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		const preview = container.querySelector('.fb-calc-builder__preview') as HTMLElement
		expect(preview.textContent).toBe('Price × ?')
	})

	it('warns about an invalid stored value instead of silently clobbering it', () => {
		setField({ type: 'bogus', anything: 1 })
		const { container } = render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.getByText(keys.calcBuilderStoredInvalid)).toBeTruthy()
		expect(container.querySelector('select.fb-calc-builder__seed')).toBeTruthy()
		cleanup()

		setField(undefined)
		render(<CalcExpressionBuilder path="fields.4.expression" field={{}} />)
		expect(screen.queryByText(keys.calcBuilderStoredInvalid)).toBeNull()
	})

	it('disables every control and blocks writes when readOnly', () => {
		const setValue = setField(rightNested)
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
		const kind = container.querySelector('select.fb-calc-operand__kind') as HTMLElement
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

describe('CalcExpressionBuilder sources', () => {
	const demoSources = [
		{
			key: 'serviceFee',
			label: { en: 'Service fee', de: 'Servicegebühr' },
			scalar: true,
			weights: false,
		},
		{ key: 'partnerDiscount', label: 'Partner discount', scalar: true, weights: true },
	]

	it('offers scalar sources in the Start with picker under a group and seeds a source node', () => {
		const setValue = setField(undefined)
		const { container } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		const seed = container.querySelector('select.fb-calc-builder__seed') as HTMLSelectElement
		const group = seed.querySelector('optgroup') as HTMLOptGroupElement
		expect(group.getAttribute('label')).toBe(keys.calcBuilderSourcesGroup)
		const grouped = Array.from(group.querySelectorAll('option')).map((option) => option.value)
		expect(grouped).toEqual(['source:serviceFee', 'source:partnerDiscount'])
		fireEvent.change(seed, { target: { value: 'source:serviceFee' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'source', source: 'serviceFee' })
	})

	it('loads a source operand: resolved label, kind select value, preview, and chain save shape', () => {
		const setValue = setField({ type: 'source', source: 'serviceFee' })
		const { container } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		expect(container.querySelector('.fb-calc-operand__source')?.textContent).toBe('Service fee')
		const kind = container.querySelector('select.fb-calc-operand__kind') as HTMLSelectElement
		expect(kind.value).toBe('source:serviceFee')
		const preview = container.querySelector('.fb-calc-builder__preview') as HTMLElement
		expect(preview.textContent).toBe('Service fee')
		fireEvent.click(screen.getByText(keys.calcBuilderAddStep))
		expect(setValue).toHaveBeenCalledWith({
			type: 'op',
			op: '*',
			left: { type: 'source', source: 'serviceFee' },
			right: { type: 'ref', field: '' },
		})
	})

	it('offers sources in the leaf kind select and switches kinds both ways', () => {
		const setValue = setField({ type: 'lit', value: 2 })
		const first = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		const kind = first.container.querySelector('select.fb-calc-operand__kind') as HTMLSelectElement
		fireEvent.change(kind, { target: { value: 'source:serviceFee' } })
		expect(setValue).toHaveBeenCalledWith({ type: 'source', source: 'serviceFee' })
		cleanup()

		const setValue2 = setField({ type: 'source', source: 'serviceFee' })
		const { container } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		const kind2 = container.querySelector('select.fb-calc-operand__kind') as HTMLSelectElement
		fireEvent.change(kind2, { target: { value: 'ref' } })
		expect(setValue2).toHaveBeenCalledWith({ type: 'ref', field: '' })
	})

	it('switches weight values between Manual and a source, preserving inline weights', () => {
		const setValue = setField({ type: 'weight', field: 'size', weights: { s: 2 } })
		const first = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		const values = first.container.querySelector(
			'select.fb-calc-operand__weight-values'
		) as HTMLSelectElement
		expect(values.value).toBe('manual')
		expect(first.container.querySelectorAll('input.fb-calc-operand__weight')).toHaveLength(2)
		fireEvent.change(values, { target: { value: 'source:partnerDiscount' } })
		expect(setValue).toHaveBeenCalledWith({
			type: 'weight',
			field: 'size',
			weights: { s: 2 },
			source: 'partnerDiscount',
		})
		cleanup()

		const setValue2 = setField({
			type: 'weight',
			field: 'size',
			weights: { s: 2 },
			source: 'partnerDiscount',
		})
		const { container } = render(
			<CalcExpressionBuilder path="fields.4.expression" field={{}} sources={demoSources} />
		)
		expect(screen.getByText(keys.calcBuilderWeightsFromSource)).toBeTruthy()
		expect(container.querySelectorAll('input.fb-calc-operand__weight')).toHaveLength(0)
		const values2 = container.querySelector(
			'select.fb-calc-operand__weight-values'
		) as HTMLSelectElement
		expect(values2.value).toBe('source:partnerDiscount')
		fireEvent.change(values2, { target: { value: 'manual' } })
		expect(setValue2).toHaveBeenCalledWith({ type: 'weight', field: 'size', weights: { s: 2 } })
	})

	it('hides the weight values select when no source offers weights', () => {
		setField({ type: 'weight', field: 'size', weights: {} })
		const { container } = render(
			<CalcExpressionBuilder
				path="fields.4.expression"
				field={{}}
				sources={[demoSources[0] as (typeof demoSources)[number]]}
			/>
		)
		expect(container.querySelector('select.fb-calc-operand__weight-values')).toBeNull()
	})
})
