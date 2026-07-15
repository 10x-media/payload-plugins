import { Form } from '@10x-media/form-builder/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { repeaterField } from '../fields/repeater-field'
import { textField } from '../fields/text-field'

afterEach(() => {
	cleanup()
})

const renderRepeater = (
	options: { minRows?: number; maxRows?: number; initialValue?: Record<string, unknown>[] } = {}
) => {
	const { minRows, maxRows, initialValue } = options
	return render(
		<Form
			form={{
				id: 1,
				fields: [
					{
						blockType: 'repeater',
						name: 'members',
						label: 'Members',
						minRows,
						maxRows,
						subFields: [{ blockType: 'text', name: 'firstName', label: 'First name' }],
					},
				],
			}}
			onSubmit={vi.fn()}
			renderers={{ repeater: repeaterField, text: textField }}
			initialValues={initialValue ? { members: initialValue } : undefined}
			layout={false}
		/>
	)
}

describe('shadcn repeater field', () => {
	it('renders an add-row button with no rows by default', () => {
		renderRepeater()
		expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument()
		expect(screen.queryByRole('textbox')).toBeNull()
	})

	it('adds a row and renders its sub-fields', () => {
		renderRepeater()
		fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
		expect(screen.getAllByRole('textbox')).toHaveLength(1)
	})

	it('removes a row on remove click', () => {
		renderRepeater()
		fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
		fireEvent.click(screen.getByRole('button', { name: /Remove/ }))
		expect(screen.queryByRole('textbox')).toBeNull()
	})

	it('seeds minRows empty rows on mount when the value is empty', () => {
		renderRepeater({ minRows: 2 })
		expect(screen.getAllByRole('textbox')).toHaveLength(2)
	})

	it('does not overwrite a prefilled value with existing rows', () => {
		renderRepeater({ minRows: 2, initialValue: [{ firstName: 'Jo' }] })
		expect(screen.getAllByRole('textbox')).toHaveLength(1)
	})

	it('hides the add button at maxRows and the remove button at minRows', () => {
		renderRepeater({ minRows: 1, maxRows: 1, initialValue: [{ firstName: 'Jo' }] })
		expect(screen.queryByRole('button', { name: 'Add row' })).toBeNull()
		expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull()
	})
})
