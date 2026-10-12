import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { de } from '../translations/de'
import { en } from '../translations/en'
import { keys } from '../translations/keys'
import { ComparisonDelta } from './ComparisonDelta'

vi.mock('@payloadcms/ui', () => ({
	Pill: ({
		children,
		className,
		pillStyle,
	}: {
		children?: ReactNode
		className?: string
		pillStyle?: string
	}) => (
		<span className={className} data-pill-style={pillStyle}>
			{children}
		</span>
	),
}))

afterEach(cleanup)

const t = (key: string): string => key

/** A bundle's own strings, filled the way Payload fills them. */
const speaking =
	(bundle: Record<string, string>) =>
	(key: string, vars?: Record<string, string>): string =>
		(bundle[key] ?? key).replace(/\{\{(.*?)\}\}/g, (match, name: string) =>
			String(vars?.[name.trim()] ?? match)
		)

const nameOf = (container: HTMLElement): string | null | undefined =>
	container.querySelector('[role="img"]')?.getAttribute('aria-label')

const change = (container: HTMLElement): HTMLElement | null =>
	container.querySelector<HTMLElement>('.analytics-delta__change')

describe('ComparisonDelta', () => {
	it('tints a rise in a count as a change for the better, in a Payload success pill', () => {
		const { container } = render(
			<ComparisonDelta current={120} locale="en" metric="pageviews" previous={100} t={t} />
		)
		expect(change(container)?.className).toContain('analytics-delta__change--up')
		expect(change(container)?.dataset.pillStyle).toBe('success')
		expect(change(container)?.textContent).toBe('20%')
		expect(container.querySelector('.analytics-delta__arrow--down')).toBeNull()
	})

	it('tints a rise in the bounce rate as a change for the worse', () => {
		const { container } = render(
			<ComparisonDelta current={0.6} locale="en" metric="bounceRate" previous={0.5} t={t} />
		)
		expect(change(container)?.className).toContain('analytics-delta__change--down')
		expect(change(container)?.dataset.pillStyle).toBe('error')
	})

	it('points the arrow down for a fall, whatever its tint', () => {
		const { container } = render(
			<ComparisonDelta current={0.4} locale="en" metric="bounceRate" previous={0.5} t={t} />
		)
		expect(change(container)?.className).toContain('analytics-delta__change--up')
		expect(container.querySelector('.analytics-delta__arrow--down')).not.toBeNull()
	})

	it('draws an unchanged value neutral and with no arrow', () => {
		const { container } = render(
			<ComparisonDelta current={100} locale="en" metric="pageviews" previous={100} t={t} />
		)
		expect(change(container)?.className).toContain('analytics-delta__change--none')
		expect(container.querySelector('.analytics-delta__arrow')).toBeNull()
	})

	it('leaves the caption to a list that says it once, its name still saying it', () => {
		const { container } = render(
			<ComparisonDelta
				caption={false}
				current={120}
				locale="en"
				metric="pageviews"
				previous={100}
				t={t}
			/>
		)
		expect(container.querySelector('.analytics-delta__caption')).toBeNull()
		expect(nameOf(container)).toBe(keys.comparisonChangeLabel)
	})

	// One sentence per language, so a locale can put the change and the comparison in its own order.
	it('names the change in one translated sentence', () => {
		const at = (current: number, previous: number, bundle: Record<string, string>) =>
			nameOf(
				render(
					<ComparisonDelta
						current={current}
						locale={bundle === de ? 'de' : 'en'}
						metric="pageviews"
						previous={previous}
						t={speaking(bundle)}
					/>
				).container
			)
		expect(at(120, 100, en)).toBe('Increased 20% vs. previous period')
		expect(at(120, 0, en)).toBe('Increased vs. previous period')
		expect(at(100, 100, en)).toBe('No change vs. previous period')
		expect(at(120, 100, de)).toBe('Gestiegen um 20\u00a0% gegenüber dem Vorzeitraum')
	})

	it('renders no inline style, so the stylesheet and the host can restyle it', () => {
		const { container } = render(
			<ComparisonDelta current={120} locale="en" metric="pageviews" previous={100} t={t} />
		)
		expect(container.querySelector('[style]')).toBeNull()
	})
})
