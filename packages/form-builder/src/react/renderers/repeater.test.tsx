import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useReducer, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fieldKey } from '../../fields/fieldKey'
import type { FormFieldInstance } from '../../submissions/types'
import type { FieldRenderer, FieldRendererProps } from '../contract'
import { FormContext, type FormStepInfo } from '../FormContext'
import type { RendererRegistry } from '../registry'
import { formReducer, initialFormState } from '../state'
import { repeaterRenderer } from './repeater'
import { textRenderer } from './text'

type RepeaterRow = Record<string, unknown>

// Wraps repeaterRenderer as a proper React component so hooks work inside the context.
const RepeaterField = (props: FieldRendererProps<RepeaterRow[]>) => repeaterRenderer(props)

// A stateful sub-renderer whose count lives in local React state (not props), to prove a surviving
// row keeps its own instance (and state) when a sibling row is removed.
const CounterRenderer: FieldRenderer = () => {
	const [n, setN] = useState(0)
	return createElement(
		'button',
		{ type: 'button', 'aria-label': `counter ${n}`, onClick: () => setN((v) => v + 1) },
		`n=${n}`
	)
}

afterEach(() => {
	cleanup()
})

const step: FormStepInfo = {
	stepIndex: 0,
	stepCount: 1,
	isFirst: true,
	isTerminal: true,
	goNext: () => {},
	goBack: () => {},
}

const makeRegistry = (extra: Record<string, typeof textRenderer> = {}): RendererRegistry =>
	new Map([
		['text', textRenderer as never],
		...Object.entries(extra).map(([k, v]) => [k, v as never] as [string, never]),
	])

const subFields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'firstName', label: 'First name' },
	{ blockType: 'text', name: 'lastName', label: 'Last name' },
]

const field: FormFieldInstance = {
	blockType: 'repeater',
	name: 'members',
	label: 'Members',
	subFields,
}

const Harness = ({
	fieldDef = field,
	initialValue = [],
	rendererRegistry = makeRegistry(),
	initialErrors = {},
}: {
	fieldDef?: FormFieldInstance
	initialValue?: unknown[]
	rendererRegistry?: RendererRegistry
	initialErrors?: Record<string, string[]>
}) => {
	const [state, dispatch] = useReducer(formReducer, {
		...initialFormState({ [fieldKey(fieldDef)]: initialValue }),
		errors: initialErrors,
	})
	const validateField = vi.fn()
	return (
		<FormContext.Provider
			value={{
				form: { id: 1, fields: [], multistep: false, pollEnabled: false },
				state,
				dispatch,
				validateField,
				locale: 'en',
				step,
				rendererRegistry,
				labels: { prev: 'Back', next: 'Next', submit: 'Submit' },
				t: (key) => key,
			}}
		>
			{createElement(RepeaterField, {
				field: fieldDef,
				id: 'rep',
				name: fieldKey(fieldDef),
				value: initialValue as never,
				onChange: () => {},
				onBlur: () => {},
				errors: [],
				required: false,
				locale: 'en',
				t: (k: string) => k,
			})}
		</FormContext.Provider>
	)
}

describe('repeaterRenderer', () => {
	it('renders an add button when no rows exist', () => {
		render(<Harness />)
		expect(screen.getByRole('button', { name: /formBuilder:repeater\.addRow/i })).toBeDefined()
	})

	it('adds a row when the add button is clicked', () => {
		render(<Harness />)
		fireEvent.click(screen.getByRole('button', { name: /formBuilder:repeater\.addRow/i }))
		expect(
			screen.getAllByRole('button', { name: /formBuilder:repeater\.removeRow/i })
		).toHaveLength(1)
	})

	it('renders sub-fields for each row', () => {
		render(<Harness initialValue={[{ firstName: 'Jo', lastName: 'Smith' }]} />)
		const inputs = screen.getAllByRole('textbox')
		expect(inputs).toHaveLength(2)
	})

	it('removes a row on remove button click', () => {
		render(<Harness initialValue={[{ firstName: 'Jo' }, { firstName: 'Al' }]} />)
		const removeButtons = screen.getAllByRole('button', {
			name: /formBuilder:repeater\.removeRow/i,
		})
		expect(removeButtons).toHaveLength(2)
		const [firstRemove] = removeButtons
		if (firstRemove) fireEvent.click(firstRemove)
		expect(
			screen.getAllByRole('button', { name: /formBuilder:repeater\.removeRow/i })
		).toHaveLength(1)
	})

	it('hides the add button when maxRows is reached', () => {
		const f: FormFieldInstance = { ...field, maxRows: 1 }
		render(<Harness fieldDef={f} initialValue={[{ firstName: 'Jo' }]} />)
		expect(screen.queryByRole('button', { name: /formBuilder:repeater\.addRow/i })).toBeNull()
	})

	it('does not show remove button when at minRows', () => {
		const f: FormFieldInstance = { ...field, minRows: 1 }
		render(<Harness fieldDef={f} initialValue={[{ firstName: 'Jo' }]} />)
		expect(screen.queryByRole('button', { name: /formBuilder:repeater\.removeRow/i })).toBeNull()
	})

	it('uses a custom addLabel when provided', () => {
		const f: FormFieldInstance = { ...field, addLabel: 'Add member' }
		render(<Harness fieldDef={f} />)
		expect(screen.getByRole('button', { name: 'Add member' })).toBeDefined()
	})

	it('skips sub-fields with no registered renderer', () => {
		const f: FormFieldInstance = {
			...field,
			subFields: [{ blockType: 'unknown-type', name: 'x', label: 'X' }],
		}
		render(<Harness fieldDef={f} initialValue={[{ x: 'hi' }]} />)
		expect(screen.queryByRole('textbox')).toBeNull()
	})

	it('clears a sub-field composite error when that sub-field is edited', () => {
		render(
			<Harness
				initialValue={[{ firstName: '' }]}
				initialErrors={{ 'members[0].firstName': ['Fix me'] }}
			/>
		)
		expect(screen.getByText('Fix me')).toBeInTheDocument()
		const [firstInput] = screen.getAllByRole('textbox')
		if (firstInput) fireEvent.change(firstInput, { target: { value: 'Jo' } })
		expect(screen.queryByText('Fix me')).toBeNull()
	})

	it('re-attributes a surviving row composite error to its new index when a middle row is removed', () => {
		render(
			<Harness
				initialValue={[{}, {}, {}]}
				initialErrors={{
					'members[0].firstName': ['first bad'],
					'members[2].lastName': ['third bad'],
				}}
			/>
		)
		// All three seeded errors render before removal.
		expect(screen.getByText('first bad')).toBeInTheDocument()
		expect(screen.getByText('third bad')).toBeInTheDocument()

		const removes = screen.getAllByRole('button', { name: /formBuilder:repeater\.removeRow/i })
		expect(removes).toHaveLength(3)
		if (removes[1]) fireEvent.click(removes[1])

		// Row 0 is untouched; the row that was index 2 is now index 1 and keeps its error (shifted from
		// members[2] to members[1]) rather than orphaning it at a now-missing index.
		expect(
			screen.getAllByRole('button', { name: /formBuilder:repeater\.removeRow/i })
		).toHaveLength(2)
		expect(screen.getByText('first bad')).toBeInTheDocument()
		expect(screen.queryAllByText('third bad')).toHaveLength(1)
	})

	it('keeps a stateful sub-renderer state on surviving rows when a middle row is removed', () => {
		const f: FormFieldInstance = {
			...field,
			subFields: [{ blockType: 'counter', name: 'c', label: 'C' }],
		}
		render(
			<Harness
				fieldDef={f}
				initialValue={[{}, {}, {}]}
				rendererRegistry={makeRegistry({ counter: CounterRenderer as never })}
			/>
		)
		const counters = () => screen.getAllByRole('button', { name: /^counter/ })
		const click = (el?: HTMLElement) => {
			if (el) fireEvent.click(el)
		}
		click(counters()[0])
		click(counters()[0])
		for (let i = 0; i < 3; i++) click(counters()[2])
		expect(counters().map((b) => b.getAttribute('aria-label'))).toEqual([
			'counter 2',
			'counter 0',
			'counter 3',
		])
		const removes = screen.getAllByRole('button', { name: /formBuilder:repeater\.removeRow/i })
		click(removes[1])
		// With stable row keys the survivors keep their instances; index keys would strand row 2's state
		// onto the removed row's instance, collapsing this to ['counter 2', 'counter 0'].
		expect(counters().map((b) => b.getAttribute('aria-label'))).toEqual(['counter 2', 'counter 3'])
	})
})
