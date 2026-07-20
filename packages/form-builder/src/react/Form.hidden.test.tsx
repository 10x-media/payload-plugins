import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], id: number | string = 1): FormDocument => ({
	id,
	fields,
	multistep: false,
	pollEnabled: false,
})

describe('Form hidden fields', () => {
	it('does not render a hidden field', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'utm', label: 'UTM Source', hidden: true },
			{ blockType: 'text', name: 'email', label: 'Email' },
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)

		expect(screen.queryByRole('textbox', { name: 'UTM Source' })).toBeNull()
		expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument()
	})

	it('submits a hidden field value seeded via initialValues', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'utm', label: 'UTM Source', hidden: true },
			{ blockType: 'text', name: 'email', label: 'Email', required: true },
		]
		render(
			<Form
				form={doc(fields, 7)}
				initialValues={{ utm: 'google', email: 'test@example.com' }}
				onSubmit={onSubmit}
			/>
		)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 7,
				values: expect.arrayContaining([
					{ field: 'utm', value: 'google' },
					{ field: 'email', value: 'test@example.com' },
				]),
			})
		})
	})

	it('a non-hidden field still renders and submits normally', () => {
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument()
	})
})
