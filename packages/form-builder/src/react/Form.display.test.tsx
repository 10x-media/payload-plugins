import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormFieldInstance } from '../submissions/types'
import { Form, type FormDocument } from './Form'

afterEach(() => {
	cleanup()
})

const lexical = (text: string) => ({
	root: {
		type: 'root',
		children: [{ type: 'paragraph', children: [{ type: 'text', text }] }],
	},
})

const doc = (fields: FormFieldInstance[], extra?: Partial<FormDocument>): FormDocument => ({
	id: 1,
	fields,
	...extra,
})

const nameField: FormFieldInstance[] = [{ blockType: 'text', name: 'name', label: 'Name' }]

describe('Form display settings', () => {
	it('renders the display title as an h2 when showTitle is on', () => {
		const form = doc(nameField, { display: { showTitle: true, title: 'Contact us' } })
		render(<Form form={form} onSubmit={vi.fn()} />)
		const heading = screen.getByRole('heading', { level: 2, name: 'Contact us' })
		expect(heading).toHaveClass('fb-form__title')
	})

	it('does not render the title when showTitle is off, even if title is set', () => {
		const form = doc(nameField, { display: { showTitle: false, title: 'Contact us' } })
		render(<Form form={form} onSubmit={vi.fn()} />)
		expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
	})

	it('does not render the title when showTitle is on but title is empty', () => {
		const form = doc(nameField, { display: { showTitle: true } })
		render(<Form form={form} onSubmit={vi.fn()} />)
		expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
	})

	it('interpolates recall tokens in the title', () => {
		const form = doc(nameField, { display: { showTitle: true, title: 'Hi {{name}}' } })
		render(<Form form={form} onSubmit={vi.fn()} />)
		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } })
		expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Hi Ada')
	})

	it('renders the intro as escaped HTML above the fields', () => {
		const form = doc(nameField, { display: { intro: lexical('Welcome <b>friend</b>') } })
		const { container } = render(<Form form={form} onSubmit={vi.fn()} />)
		const intro = container.querySelector('.fb-form__intro')
		expect(intro?.innerHTML).toBe('<p>Welcome &lt;b&gt;friend&lt;/b&gt;</p>')
	})

	it('renders nothing for intro when unset', () => {
		const form = doc(nameField)
		const { container } = render(<Form form={form} onSubmit={vi.fn()} />)
		expect(container.querySelector('.fb-form__intro')).toBeNull()
	})

	it('hides title and intro on the custom children path', () => {
		const form = doc(nameField, {
			display: { showTitle: true, title: 'Contact us', intro: lexical('Welcome') },
		})
		const { container } = render(
			<Form form={form} onSubmit={vi.fn()}>
				<button type="submit">Go</button>
			</Form>
		)
		expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
		expect(container.querySelector('.fb-form__intro')).toBeNull()
	})

	it('hides title and intro once the form has been submitted', async () => {
		const onSubmit = vi.fn().mockResolvedValue({ ok: true })
		const form = doc(nameField, {
			display: { showTitle: true, title: 'Contact us', intro: lexical('Welcome') },
		})
		const { container } = render(<Form form={form} onSubmit={onSubmit} />)

		fireEvent.click(screen.getByRole('button', { name: 'Submit' }))

		await screen.findByRole('status')
		expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
		expect(container.querySelector('.fb-form__intro')).toBeNull()
	})
})
