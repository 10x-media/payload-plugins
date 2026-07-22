import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'
import { FormFields } from './FormFields'

afterEach(cleanup)

const fields: FormFieldInstance[] = [{ blockType: 'text', name: 'first', label: 'First' }]
const doc: FormDocument = { id: 1, fields, multistep: false, pollEnabled: false }

describe('Form header slot', () => {
	it('renders the header above the fields in default mode', () => {
		const { container } = render(
			<Form form={doc} onSubmit={vi.fn()} header={<div data-testid="hdr">Progress</div>} />
		)
		const header = screen.getByTestId('hdr')
		const firstField = container.querySelector('[data-width]')
		expect(header).toBeInTheDocument()
		expect(firstField).not.toBeNull()
		// The header precedes the first field in document order.
		expect(
			header.compareDocumentPosition(firstField as Node) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy()
	})

	it('does not render the header in children mode', () => {
		render(
			<Form form={doc} onSubmit={vi.fn()} header={<div data-testid="hdr" />}>
				<FormFields />
			</Form>
		)
		expect(screen.queryByTestId('hdr')).toBeNull()
	})
})
