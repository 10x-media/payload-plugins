import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../../submissions/types'
import type { FieldRendererProps } from '../contract'
import { FormContext, type FormStepInfo } from '../FormContext'
import type { RendererRegistry } from '../registry'
import { formReducer, initialFormState } from '../state'
import { repeaterRenderer } from './repeater'
import { textRenderer } from './text'

type RepeaterRow = Record<string, unknown>

// Wraps repeaterRenderer as a proper React component so hooks work inside the context.
const RepeaterField = (props: FieldRendererProps<RepeaterRow[]>) => repeaterRenderer(props)

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
}: {
	fieldDef?: FormFieldInstance
	initialValue?: unknown[]
	rendererRegistry?: RendererRegistry
}) => {
	const [state, dispatch] = useReducer(
		formReducer,
		initialFormState({ [fieldDef.name]: initialValue })
	)
	const validateField = vi.fn()
	return (
		<FormContext.Provider
			value={{
				state,
				dispatch,
				validateField,
				locale: 'en',
				step,
				rendererRegistry,
				labels: { back: 'Back', next: 'Next', submit: 'Submit' },
				t: (key) => key,
			}}
		>
			{createElement(RepeaterField, {
				field: fieldDef,
				id: 'rep',
				name: fieldDef.name,
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
})
