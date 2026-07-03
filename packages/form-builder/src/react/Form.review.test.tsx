import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(cleanup)

const doc = (fields: FormFieldInstance[]): FormDocument => ({ id: 1, fields })

describe('Form submit hardening', () => {
	it('does not double-submit on a rapid second activation', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		render(
			<Form form={doc([{ blockType: 'text', name: 'name', label: 'Name' }])} onSubmit={onSubmit} />
		)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jo' } })
		const button = screen.getByRole('button', { name: 'Submit' })
		fireEvent.click(button)
		fireEvent.click(button)
		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
	})

	it('does not block submit on a required field whose validateWhen is unmet (matches the server)', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				validateWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)
		// `plan` is empty, so `detail`'s validateWhen is false: the client must not validate it (the server does not).
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		await waitFor(() => expect(onSubmit).toHaveBeenCalled())
	})

	it('still validates a required field whose validateWhen is met', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const fields: FormFieldInstance[] = [
			{ blockType: 'text', name: 'plan', label: 'Plan' },
			{
				blockType: 'text',
				name: 'detail',
				label: 'Detail',
				required: true,
				validateWhen: { or: [{ and: [{ plan: { equals: 'pro' } }] }] },
			},
		]
		render(<Form form={doc(fields)} onSubmit={onSubmit} />)
		fireEvent.change(screen.getByLabelText('Plan'), { target: { value: 'pro' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
		expect(await screen.findByRole('alert')).toHaveTextContent('This field is required')
		expect(onSubmit).not.toHaveBeenCalled()
	})
})
