import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFlow } from '../flow/types'
import type { FormDocument, FormResponseSettings } from '../form/types'
import type { FormFieldInstance } from '../submissions/types'
import { Form } from './Form'
import { useFormContext } from './FormContext'
import type { SubmitButtonRenderProps } from './FormControls'

afterEach(() => {
	cleanup()
})

const fields: FormFieldInstance[] = [
	{ blockType: 'text', name: 'first', label: 'First' },
	{ blockType: 'text', name: 'last', label: 'Last' },
]

const flow: FormFlow = {
	steps: [
		{ id: 's1', fields: ['first'], next: 's2' },
		{ id: 's2', fields: ['last'] },
	],
}

const doc = (extra?: Partial<FormDocument>): FormDocument => ({ id: 1, fields, ...extra })

describe('button label resolution', () => {
	it('uses the stored buttons.submitLabel when no prop is passed', () => {
		render(<Form form={doc({ buttons: { submitLabel: 'Send it' } })} onSubmit={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument()
	})

	it('submitLabel prop wins over the stored value', () => {
		render(
			<Form
				form={doc({ buttons: { submitLabel: 'Send it' } })}
				onSubmit={vi.fn()}
				submitLabel="Go"
			/>
		)
		expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
	})

	it('falls back to the translated default when the stored label is absent or empty', () => {
		render(<Form form={doc({ buttons: { submitLabel: '' } })} onSubmit={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
	})

	it('doc-driven next and prev labels drive the multi-step chrome', async () => {
		const form = doc({ flow, buttons: { nextLabel: 'Continue', prevLabel: 'Previous' } })
		render(<Form form={form} onSubmit={vi.fn()} />)
		fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
		expect(await screen.findByRole('button', { name: 'Previous' })).toBeInTheDocument()
	})

	it('next and prev props win over the stored values', async () => {
		const form = doc({ flow, buttons: { nextLabel: 'Continue', prevLabel: 'Previous' } })
		render(<Form form={form} onSubmit={vi.fn()} nextLabel="Onward" prevLabel="Rewind" />)
		fireEvent.click(screen.getByRole('button', { name: 'Onward' }))
		expect(await screen.findByRole('button', { name: 'Rewind' })).toBeInTheDocument()
	})

	it('ignores a legacy response.submitLabel', () => {
		const legacy = { type: 'message', submitLabel: 'Legacy' } as FormResponseSettings
		render(<Form form={doc({ response: legacy })} onSubmit={vi.fn()} />)
		expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
	})
})

describe('host-extended buttons read from context', () => {
	const icons: Record<string, string> = { 'arrow-right': '→' }

	const SubmitWithIcon = ({ label, submitting }: SubmitButtonRenderProps) => {
		const { form } = useFormContext()
		const icon = typeof form.buttons?.submitIcon === 'string' ? form.buttons.submitIcon : undefined
		return (
			<button type="submit" disabled={submitting}>
				{icon ? <span aria-hidden>{icons[icon]}</span> : null}
				{label}
			</button>
		)
	}

	it('a custom renderSubmit reads a host-added buttons key via useFormContext', () => {
		const form = doc({ buttons: { submitLabel: 'Send', submitIcon: 'arrow-right' } })
		render(
			<Form
				form={form}
				onSubmit={vi.fn()}
				renderSubmit={(props) => <SubmitWithIcon {...props} />}
			/>
		)
		const button = screen.getByRole('button', { name: 'Send' })
		expect(button.textContent).toContain('→')
	})
})
