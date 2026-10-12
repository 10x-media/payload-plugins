import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsFilter } from '../../core/contract'
import { ar } from '../../translations/ar'
import { en } from '../../translations/en'
import { FilterChips } from './FilterChips'

/** The admin's strings, which a test switches to read another locale. */
const admin = vi.hoisted(() => ({ strings: {} as Record<string, string> }))

vi.mock('@payloadcms/ui', () => ({
	Pill: ({ children }: { children?: ReactNode }) => <span className="pill">{children}</span>,
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, string>) =>
			(admin.strings[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) =>
				String(vars?.[name.trim()] ?? match)
			),
	}),
	XIcon: () => <span aria-hidden="true" />,
}))

beforeEach(() => {
	admin.strings = en
})

afterEach(() => {
	cleanup()
})

const FILTERS: AnalyticsFilter[] = [
	{ dimension: 'page', operator: 'eq', value: '/pricing' },
	{ dimension: 'page', operator: 'contains', value: '/blog' },
	{ dimension: 'browser', operator: 'eq', value: 'firefox' },
]

/** The chips as the toolbar keeps them: a removal is a new list, a render later. */
function Chips({ initial }: { initial: AnalyticsFilter[] }) {
	const [filters, setFilters] = useState(initial)
	return (
		<>
			<FilterChips
				countryFlags={false}
				filters={filters}
				goals={[]}
				locale="en"
				onRemove={(index) => setFilters((all) => all.filter((_, at) => at !== index))}
				provider="native"
			/>
			<button type="button">after</button>
		</>
	)
}

const removeButtons = (): HTMLElement[] =>
	screen.queryAllByRole('button', { name: /^Remove filter: / })

describe('FilterChips focus', () => {
	it('moves focus to the chip that took the removed one place', async () => {
		render(<Chips initial={FILTERS} />)
		const [first] = removeButtons()
		first?.focus()
		await act(async () => {
			fireEvent.click(first as HTMLElement)
		})
		expect(removeButtons()).toHaveLength(2)
		expect(document.activeElement).toBe(removeButtons()[0])
		expect(document.activeElement?.getAttribute('aria-label')).toContain('/blog')
	})

	it('moves focus to the chip before it when the last one goes', async () => {
		render(<Chips initial={FILTERS} />)
		await act(async () => {
			fireEvent.click(removeButtons()[2] as HTMLElement)
		})
		expect(document.activeElement).toBe(removeButtons()[1])
	})

	it('moves focus to the Filters label when no chip is left, then lets it go', async () => {
		render(<Chips initial={[FILTERS[0] as AnalyticsFilter]} />)
		await act(async () => {
			fireEvent.click(removeButtons()[0] as HTMLElement)
		})
		expect(removeButtons()).toHaveLength(0)
		expect(document.activeElement?.textContent).toBe('Filters')
		await act(async () => {
			screen.getByRole('button', { name: 'after' }).focus()
		})
		expect(screen.queryByText('Filters')).toBeNull()
	})

	// Collapsing the row between pointer down and up would move the next control from under the
	// pointer, landing its click on the section around it.
	it('keeps the Filters label until the press that moved focus away has ended', async () => {
		render(<Chips initial={[FILTERS[0] as AnalyticsFilter]} />)
		await act(async () => {
			fireEvent.click(removeButtons()[0] as HTMLElement)
		})
		const after = screen.getByRole('button', { name: 'after' })
		await act(async () => {
			fireEvent.pointerDown(after)
			after.focus()
		})
		expect(screen.getByText('Filters')).toBeTruthy()
		await act(async () => {
			fireEvent.pointerUp(after)
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(screen.queryByText('Filters')).toBeNull()
	})
})

describe('FilterChips direction', () => {
	// A path keeps its own reading order inside a right-to-left sentence.
	it('isolates each value, on screen and in its remove button name', () => {
		const { container } = render(<Chips initial={FILTERS} />)
		const values = [...container.querySelectorAll('bdi')].map((bdi) => bdi.textContent)
		expect(values).toHaveLength(3)
		expect(values.slice(0, 2)).toEqual(['/pricing', '/blog'])
		expect(removeButtons()[0]?.getAttribute('aria-label')).toContain('⁨/pricing⁩')
	})
})

describe('FilterChips wording', () => {
	const chipTexts = (container: HTMLElement): string[] =>
		[...container.querySelectorAll('.pill')].map((pill) => pill.textContent ?? '')

	// Words, not signs: "~" and "≈" mean nothing to a site owner, and a screen reader skips them.
	it('words each filter as the widget captions do, with the value named', () => {
		const { container } = render(<Chips initial={FILTERS} />)
		expect(chipTexts(container)).toEqual([
			'Page is /pricing',
			'Page contains /blog',
			'Browser is Firefox',
		])
		expect(removeButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
			'Remove filter: Page is ⁨/pricing⁩',
			'Remove filter: Page contains ⁨/blog⁩',
			'Remove filter: Browser is ⁨Firefox⁩',
		])
	})

	it('lets a locale order the sentence and agree the operator with its own words', () => {
		admin.strings = ar
		const { container } = render(
			<Chips initial={[{ dimension: 'page', operator: 'matches', value: '^/docs' }]} />
		)
		expect(chipTexts(container)).toEqual(['قيمة الصفحة تطابق النمط ^/docs'])
	})
})
