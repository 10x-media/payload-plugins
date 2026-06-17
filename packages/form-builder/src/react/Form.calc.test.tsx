import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalcExpression } from '../calc/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const doc = (fields: FormFieldInstance[], id: number | string = 1): FormDocument => ({ id, fields })

const sum: CalcExpression = {
	type: 'op',
	op: '+',
	left: { type: 'ref', field: 'a' },
	right: { type: 'ref', field: 'b' },
}

describe('Form calculation fields', () => {
	it('renders the live computed total as the inputs change', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'number', name: 'b', label: 'B' },
			{ blockType: 'calculation', name: 'total', label: 'Total', expression: sum },
		]
		const { container } = render(<Form form={doc(fields)} onSubmit={vi.fn()} />)

		const output = container.querySelector('output')
		expect(output).not.toBeNull()
		expect(output?.textContent).toBe('0')

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '3' } })
		fireEvent.change(screen.getByLabelText('B'), { target: { value: '4' } })

		expect(container.querySelector('output')?.textContent).toBe('7')
	})

	it('does not render the calc field as an editable input', () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'calculation', name: 'total', label: 'Total', expression: sum },
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)
		expect(screen.queryByRole('textbox', { name: 'Total' })).toBeNull()
		expect(screen.queryByRole('spinbutton', { name: 'Total' })).toBeNull()
	})

	it('recalls the computed total in the success message after submit', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'number', name: 'b', label: 'B' },
			{ blockType: 'calculation', name: 'total', label: 'Total', expression: sum },
		]
		render(
			<Form form={doc(fields, 5)} onSubmit={onSubmit} successMessage="Your total is {{total}}." />
		)

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '10' } })
		fireEvent.change(screen.getByLabelText('B'), { target: { value: '5' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		expect(await screen.findByText('Your total is 15.')).toBeInTheDocument()
	})

	it('submits the computed total as a value', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'number', name: 'b', label: 'B' },
			{ blockType: 'calculation', name: 'total', label: 'Total', expression: sum },
		]
		render(<Form form={doc(fields, 9)} onSubmit={onSubmit} />)

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '2' } })
		fireEvent.change(screen.getByLabelText('B'), { target: { value: '6' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 9,
				values: expect.arrayContaining([
					{ field: 'a', value: 2 },
					{ field: 'b', value: 6 },
					{ field: 'total', value: 8 },
				]),
			})
		})
	})

	it('computes but does not render a calcDisplay:false calc, and still submits it', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'number', name: 'b', label: 'B' },
			{
				blockType: 'calculation',
				name: 'total',
				label: 'Total',
				expression: sum,
				calcDisplay: false,
			},
		]
		const { container } = render(<Form form={doc(fields, 3)} onSubmit={onSubmit} />)

		expect(container.querySelector('output')).toBeNull()
		expect(screen.queryByText('Total')).toBeNull()

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '1' } })
		fireEvent.change(screen.getByLabelText('B'), { target: { value: '1' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 3,
				values: expect.arrayContaining([{ field: 'total', value: 2 }]),
			})
		})
	})

	it('non-calc fields submit byte-identically when no calc field is present', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]
		render(<Form form={doc(fields, 4)} onSubmit={onSubmit} />)

		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 4,
				values: [{ field: 'name', value: 'Ada' }],
			})
		})
	})

	it('does not render a hidden calc field but still submits its value', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true, submissionId: '1' })
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{ blockType: 'number', name: 'b', label: 'B' },
			{ blockType: 'calculation', name: 'total', label: 'Total', expression: sum, hidden: true },
		]
		const { container } = render(<Form form={doc(fields, 6)} onSubmit={onSubmit} />)

		expect(container.querySelector('output')).toBeNull()

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '4' } })
		fireEvent.change(screen.getByLabelText('B'), { target: { value: '4' } })
		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await waitFor(() => {
			expect(onSubmit).toHaveBeenCalledWith({
				formId: 6,
				values: expect.arrayContaining([{ field: 'total', value: 8 }]),
			})
		})
	})

	it('shows a field gated on a computed calc value once the calc makes the condition true', async () => {
		const fields: FormFieldInstance[] = [
			{ blockType: 'number', name: 'a', label: 'A' },
			{
				blockType: 'calculation',
				name: 'score',
				label: 'Score',
				expression: { type: 'ref', field: 'a' },
			},
			{ blockType: 'text', name: 'bonus', label: 'Bonus', visibleWhen: { score: { equals: 5 } } },
		]
		render(<Form form={doc(fields)} onSubmit={vi.fn()} />)

		expect(screen.queryByLabelText('Bonus')).toBeNull()

		fireEvent.change(screen.getByLabelText('A'), { target: { value: '5' } })

		expect(await screen.findByLabelText('Bonus')).toBeInTheDocument()
	})
})
