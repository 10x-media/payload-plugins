import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionBoundary } from './SectionBoundary'

const Throws = (): never => {
	throw new Error('chart exploded')
}

afterEach(cleanup)

describe('SectionBoundary', () => {
	it('renders its children while they hold', () => {
		render(
			<SectionBoundary label="Analytics could not be loaded.">
				<span>rows</span>
			</SectionBoundary>
		)
		expect(screen.getByText('rows')).toBeDefined()
	})

	it('replaces a throwing section with the fallback instead of blanking the view', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		render(
			<>
				<SectionBoundary label="Analytics could not be loaded.">
					<Throws />
				</SectionBoundary>
				<span>the rest of the view</span>
			</>
		)
		expect(screen.getByText('Analytics could not be loaded.')).toBeDefined()
		expect(screen.getByText('the rest of the view')).toBeDefined()
		errors.mockRestore()
	})

	// Without this a section that threw on one range stays a fallback for the life of the
	// view, however far the reader navigates away from what broke it.
	it('clears the failure when the view state behind it changes', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { rerender } = render(
			<SectionBoundary label="Analytics could not be loaded." resetKey="range=last7days">
				<Throws />
			</SectionBoundary>
		)
		expect(screen.getByText('Analytics could not be loaded.')).toBeDefined()

		rerender(
			<SectionBoundary label="Analytics could not be loaded." resetKey="range=last30days">
				<span>rows</span>
			</SectionBoundary>
		)

		expect(screen.getByText('rows')).toBeDefined()
		errors.mockRestore()
	})

	it('keeps the fallback while the same view state is still on screen', () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
		const { rerender } = render(
			<SectionBoundary label="Analytics could not be loaded." resetKey="range=last7days">
				<Throws />
			</SectionBoundary>
		)
		rerender(
			<SectionBoundary label="Analytics could not be loaded." resetKey="range=last7days">
				<span>rows</span>
			</SectionBoundary>
		)

		expect(screen.getByText('Analytics could not be loaded.')).toBeDefined()
		errors.mockRestore()
	})
})
