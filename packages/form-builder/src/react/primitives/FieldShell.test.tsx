import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FieldShell } from './FieldShell'

afterEach(() => {
	cleanup()
})

describe('FieldShell', () => {
	it('associates the label with the control via htmlFor/id', () => {
		render(
			<FieldShell id="f1" label="Email" required describedById="f1-desc">
				<input id="f1" aria-describedby="f1-desc" />
			</FieldShell>
		)
		expect(screen.getByText('Email')).toHaveAttribute('for', 'f1')
	})

	it('renders errors as alerts inside the described-by region', () => {
		render(
			<FieldShell id="f1" describedById="f1-desc" errors={['Required']}>
				<input id="f1" aria-describedby="f1-desc" />
			</FieldShell>
		)
		const alert = screen.getByRole('alert')
		expect(alert).toHaveTextContent('Required')
		expect(alert.closest('#f1-desc')).not.toBeNull()
	})

	it('renders a plain span carrying the label id when group is true, not a label[for]', () => {
		render(
			<FieldShell id="f1" label="Plan" describedById="f1-desc" group>
				<div role="radiogroup" aria-labelledby="f1-label" aria-describedby="f1-desc" />
			</FieldShell>
		)
		const caption = screen.getByText('Plan')
		expect(caption.tagName).toBe('SPAN')
		expect(caption).not.toHaveAttribute('for')
		expect(caption).toHaveAttribute('id', 'f1-label')
		expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Plan')
	})

	it('still renders a label[for] bound to the control id when group is false (default)', () => {
		render(
			<FieldShell id="f1" label="Email" describedById="f1-desc">
				<input id="f1" aria-describedby="f1-desc" />
			</FieldShell>
		)
		const caption = screen.getByText('Email')
		expect(caption.tagName).toBe('LABEL')
		expect(caption).toHaveAttribute('for', 'f1')
		expect(caption).toHaveAttribute('id', 'f1-label')
	})
})
