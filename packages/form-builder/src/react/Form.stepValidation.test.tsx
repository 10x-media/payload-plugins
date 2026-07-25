import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(cleanup)

const fields: FormFieldInstance[] = [
	{
		blockType: 'repeater',
		name: 'people',
		label: 'People',
		addLabel: 'Add person',
		subFields: [{ blockType: 'text', name: 'email', label: 'Email', required: true }],
	},
	{ blockType: 'text', name: 'note', label: 'Note' },
]

const flow: FormFlow = {
	steps: [
		{ id: 's1', fields: ['people'], next: 's2' },
		{ id: 's2', fields: ['note'] },
	],
}

const doc: FormDocument = { id: 1, fields, flow, multistep: true, pollEnabled: false }

describe('Form step navigation with a repeater', () => {
	it('does not advance when a required repeater sub-field is invalid', async () => {
		render(<Form form={doc} onSubmit={vi.fn()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// goNext validates the step's repeater sub-fields: the empty required email surfaces an error...
		await screen.findAllByRole('alert')
		// ...and the step does not advance (no Back control appears; the repeater step is still shown).
		expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
		expect(screen.getByRole('button', { name: 'Add person' })).toBeInTheDocument()
	})

	it('advances once the required repeater sub-field is filled', async () => {
		render(<Form form={doc} onSubmit={vi.fn()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Add person' }))
		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a@b.com' } })
		fireEvent.click(screen.getByRole('button', { name: 'Next' }))
		// advanced to step 2: the Back control now appears.
		expect(await screen.findByRole('button', { name: 'Back' })).toBeInTheDocument()
	})
})
