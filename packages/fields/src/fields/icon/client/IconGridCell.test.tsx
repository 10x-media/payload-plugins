// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IconMeta } from '../../../types'

// Payload's Tooltip is presentational chrome. Standing in for it keeps the assertions
// on what this cell actually decides: what goes in the accessible name, and what goes
// in the tooltip. The real Tooltip is exercised in the drawer e2e.
vi.mock('@payloadcms/ui', () => ({
	Tooltip: ({ children, show }: { children: ReactNode; show?: boolean }) =>
		show ? <div data-testid="tooltip">{children}</div> : null,
}))

const { IconGridCell } = await import('./IconGridCell')

const meta = (partial: Partial<IconMeta> & { name: string }): IconMeta => ({
	categories: [],
	tags: [],
	...partial,
})

const renderCell = (icon: IconMeta, language = 'en') =>
	render(
		<IconGridCell
			entry={undefined}
			focused={false}
			icon={icon}
			index={0}
			isSelected={false}
			language={language}
			nodes={undefined}
			onSelect={() => {}}
			registerRef={() => {}}
		/>
	)

describe('IconGridCell', () => {
	// `globals: false` in the vitest config means testing-library registers no
	// auto-cleanup, so renders would otherwise stack across cases.
	afterEach(cleanup)

	it('names a label-less icon from its sentence-cased name', () => {
		renderCell(meta({ name: 'arrow-up' }))
		expect(screen.getByRole('option').getAttribute('aria-label')).toBe('Arrow up')
	})

	// The defect: a screen reader browsing 215 countries announced 215 three-letter
	// codes. The accessible name must carry the country, and only the country.
	it('announces a library-supplied label and never the raw code', () => {
		renderCell(meta({ label: 'Hungary', name: 'HUN' }))
		const label = screen.getByRole('option').getAttribute('aria-label')
		expect(label).toBe('Hungary')
		expect(label).not.toContain('HUN')
	})

	it('announces the label for the admin language', () => {
		renderCell(meta({ label: { de: 'Ungarn', en: 'Hungary' }, name: 'HUN' }), 'de')
		expect(screen.getByRole('option').getAttribute('aria-label')).toBe('Ungarn')
	})

	// The tooltip is the only surface where an editor can learn the stored value.
	it('shows both the label and the raw code in the tooltip', () => {
		renderCell(meta({ label: 'Hungary', name: 'HUN' }))
		fireEvent.focus(screen.getByRole('option'))
		const tooltip = screen.getByTestId('tooltip')
		expect(tooltip.textContent).toContain('Hungary')
		expect(tooltip.textContent).toContain('HUN')
	})

	it('shows only the derived label in the tooltip when no label is supplied', () => {
		renderCell(meta({ name: 'arrow-up' }))
		fireEvent.focus(screen.getByRole('option'))
		expect(screen.getByTestId('tooltip').textContent).toBe('Arrow up')
	})

	it('hands the whole manifest entry to onSelect, so a picker can keep the label', () => {
		const onSelect = vi.fn()
		const icon = meta({ label: 'Hungary', name: 'HUN' })
		render(
			<IconGridCell
				entry={undefined}
				focused={false}
				icon={icon}
				index={0}
				isSelected={false}
				language="en"
				nodes={undefined}
				onSelect={onSelect}
				registerRef={() => {}}
			/>
		)
		fireEvent.click(screen.getByRole('option'))
		expect(onSelect).toHaveBeenCalledWith(icon)
	})
})
