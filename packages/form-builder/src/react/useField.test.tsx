import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FormContext } from './FormContext'
import { formReducer, initialFormState } from './state'
import { useField } from './useField'

afterEach(() => {
	cleanup()
})

const Harness = ({ validateField }: { validateField: (name: string, value: unknown) => void }) => {
	const [state, dispatch] = useReducer(formReducer, initialFormState({ a: '' }))
	return (
		<FormContext.Provider value={{ state, dispatch, validateField, locale: 'en' }}>
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
