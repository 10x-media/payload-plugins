import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

describe('jsdom renderer test infrastructure', () => {
	it('renders a React element and queries the DOM', () => {
		render(<button type="button">Click me</button>)
		expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
	})
})
