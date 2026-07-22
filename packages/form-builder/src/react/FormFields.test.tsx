import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { FormFields } from './FormFields'

afterEach(cleanup)

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]
const doc: FormDocument = { id: 1, fields, multistep: false, pollEnabled: false }

describe('FormFields', () => {
	it('renders one wrapper per visible field in default <Form> mode', () => {
		const { container } = render(<Form form={doc} onSubmit={vi.fn()} />)
		expect(container.querySelectorAll('[data-width]')).toHaveLength(2)
	})

	it('renders the standard loop in children mode without reimplementation', () => {
		const { container } = render(
			<Form form={doc} onSubmit={vi.fn()}>
				<FormFields />
			</Form>
		)
		expect(container.querySelectorAll('[data-width]')).toHaveLength(2)
	})

	it('drops the grid class when layout is false', () => {
		const { container } = render(
			<Form form={doc} onSubmit={vi.fn()}>
				<FormFields layout={false} />
			</Form>
		)
		const el = container.querySelector('.fb-form')
		expect(el).not.toBeNull()
		expect(el).not.toHaveClass('fb-form--grid')
	})
})
