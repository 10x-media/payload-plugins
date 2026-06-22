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
})
