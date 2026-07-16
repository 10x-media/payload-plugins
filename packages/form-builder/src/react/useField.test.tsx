import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormContext, type FormStepInfo } from './FormContext'
import type { RendererRegistry } from './registry'
import { formReducer, initialFormState } from './state'
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

const Harness = ({ validateField }: { validateField: (name: string, value: unknown) => void }) => {
	const [state, dispatch] = useReducer(formReducer, initialFormState({ a: '' }))
	return (
		<FormContext.Provider
			value={{
				form: { id: 1, fields: [] },
				state,
				dispatch,
				validateField,
				locale: 'en',
				step,
				rendererRegistry: emptyRegistry,
				labels: { back: 'Back', next: 'Next', submit: 'Submit' },
				t: (key) => key,
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
})
