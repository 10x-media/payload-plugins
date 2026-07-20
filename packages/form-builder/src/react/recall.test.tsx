import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], overrides: Partial<FormDocument> = {}): FormDocument => ({
	id: 1,
	fields,
	multistep: overrides.flow !== undefined,
	pollEnabled: false,
	...overrides,
})

describe('recall in Form', () => {
	it('updates a later field label when a prior answer changes', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'text', name: 'greeting', label: 'Hello {{first}}' },
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)

		expect(screen.getByText('Hello')).toBeInTheDocument()

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })

		await waitFor(() => {
			expect(screen.getByText('Hello Ada')).toBeInTheDocument()
		})
	})

	it('interpolates the success message with the submitted answer', async () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'first', label: 'First' }]
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(<Form form={doc(fields)} onSubmit={onSubmit} successMessage="Thanks {{first}}" />)

		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Thanks Ada')
		})
	})

	it('renders a token-free label verbatim (recall is a no-op)', () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'first', label: 'Plain label' }]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		expect(screen.getByLabelText('Plain label')).toBeInTheDocument()
	})

	it('recalls an answer into a select option label', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{
				blockType: 'select',
				name: 'plan',
				label: 'Plan',
				options: [{ label: 'For {{first}}', value: 'x' }],
			},
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		await waitFor(() => {
			expect(screen.getByRole('option', { name: 'For Ada' })).toBeInTheDocument()
		})
	})

	it('recalls an earlier step answer into a later step label', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'first', label: 'First' },
			{ blockType: 'text', name: 'greeting', label: 'Hi {{first}}' },
		]
		const flow: FormFlow = {
			steps: [
				{ id: 's1', fields: ['first'], next: 's2' },
				{ id: 's2', fields: ['greeting'] },
			],
		}
		render(<Form form={doc(fields, { flow })} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('First'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		expect(await screen.findByLabelText('Hi Ada')).toBeInTheDocument()
	})
})
