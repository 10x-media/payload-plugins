import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormContext, type FormStepInfo } from './FormContext'
import type { RendererRegistry } from './registry'
import { type FormState, formReducer, initialFormState } from './state'
import { useField } from './useField'

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

const emptyRegistry: RendererRegistry = new Map()

const Harness = ({
	validateField,
	initial,
	stepIdOfField,
}: {
	validateField: (name: string, value: unknown) => void
	initial?: Partial<FormState>
	stepIdOfField?: (name: string) => string
}) => {
	const [state, dispatch] = useReducer(formReducer, {
		...initialFormState({ a: '' }),
		...initial,
	})
	return (
		<FormContext.Provider
			value={{
				form: { id: 1, fields: [], multistep: false, pollEnabled: false },
				state,
				dispatch,
				validateField,
				locale: 'en',
				step,
				rendererRegistry: emptyRegistry,
				labels: { prev: 'Back', next: 'Next', submit: 'Submit' },
				t: (key) => key,
				stepIdOfField,
			}}
		>
			<Field />
		</FormContext.Provider>
	)
}

const Field = () => {
	const { value, errors, setValue, onBlur } = useField<string>('a')
	return (
		<div>
			<input
				aria-label="a"
				value={value ?? ''}
				onChange={(e) => setValue(e.target.value)}
				onBlur={onBlur}
			/>
			<span data-testid="err">{errors.join(',')}</span>
		</div>
	)
}

describe('useField', () => {
	it('updates value and validates on blur', () => {
		const validateField = vi.fn()
		render(<Harness validateField={validateField} />)
		const input = screen.getByLabelText('a')
		fireEvent.change(input, { target: { value: 'x' } })
		expect(input).toHaveValue('x')
		fireEvent.blur(input)
		expect(validateField).toHaveBeenCalledWith('a', 'x')
	})

	it('does not surface errors until touched', () => {
		const validateField = vi.fn()
		render(<Harness validateField={validateField} />)
		expect(screen.getByTestId('err')).toHaveTextContent('')
	})

	it('hides a stored error while the field is untouched and its step is unattempted', () => {
		// The error map holds an entry for `a`, but the field belongs to an unattempted step: no reveal.
		render(
			<Harness
				validateField={vi.fn()}
				initial={{ errors: { a: ['bad'] } }}
				stepIdOfField={() => 's2'}
			/>
		)
		expect(screen.getByTestId('err')).toHaveTextContent('')
	})

	it('reveals a stored error once the field’s own step has been attempted', () => {
		render(
			<Harness
				validateField={vi.fn()}
				initial={{ errors: { a: ['bad'] }, attemptedSteps: new Set(['s2']) }}
				stepIdOfField={() => 's2'}
			/>
		)
		expect(screen.getByTestId('err')).toHaveTextContent('bad')
	})

	it('does not reveal a field because an unrelated step was attempted', () => {
		// A single global flag would reveal here; a per-step reveal must not, since `a` is on s2.
		render(
			<Harness
				validateField={vi.fn()}
				initial={{ errors: { a: ['bad'] }, attemptedSteps: new Set(['s1']) }}
				stepIdOfField={() => 's2'}
			/>
		)
		expect(screen.getByTestId('err')).toHaveTextContent('')
	})

	it('does not validate on change until revealed, then validates on subsequent changes', () => {
		const validateField = vi.fn()
		render(<Harness validateField={validateField} />)
		const input = screen.getByLabelText('a')
		fireEvent.change(input, { target: { value: 'x' } })
		expect(validateField).not.toHaveBeenCalled()
		// Blur reveals the field; changes after that re-validate live.
		fireEvent.blur(input)
		validateField.mockClear()
		fireEvent.change(input, { target: { value: 'xy' } })
		expect(validateField).toHaveBeenCalledWith('a', 'xy')
	})
})
