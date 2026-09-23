// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CountryOption } from '../engine/countries'
import type { CountryCode } from '../engine/phone'
import type { PhoneFlagMode } from '../options'

// The virtualizer sizes its window from the scroll element's offsetHeight, which jsdom
// always reports as 0; without a height it would render a single row.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 280 })

// jsdom has no layout, so scrollTo/scrollTop/scrollHeight are stubbed to fake a 400px window
// over the spacer: enough for a long list to scroll and re-render, a short one to stay put.
const scrollTo = vi.fn<(options?: ScrollToOptions) => void>()
Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
	configurable: true,
	value: 0,
	writable: true,
})
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 400 })
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
	configurable: true,
	get(this: HTMLElement) {
		const spacer = this.firstElementChild
		return spacer instanceof HTMLElement ? Number.parseFloat(spacer.style.height) || 0 : 0
	},
})
Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
	configurable: true,
	value(this: HTMLElement, options?: ScrollToOptions) {
		scrollTo(options)
		this.scrollTop = options?.top ?? 0
		this.dispatchEvent(new Event('scroll'))
	},
})

type PopupDoubleProps = {
	button: ReactNode
	buttonClassName?: string
	disabled?: boolean
	onToggleClose?: () => void
	onToggleOpen?: (active: boolean) => void
	render?: (args: { close: () => void }) => ReactNode
}

// Stands in for Payload's Popup, reproducing the two behaviours the picker is built
// around: the panel is portalled to document.body, and `render` is called even while
// the popup is closed.
const PopupDouble = ({
	button,
	buttonClassName,
	disabled,
	onToggleClose,
	onToggleOpen,
	render: renderPanel,
}: PopupDoubleProps) => {
	const [active, setActive] = useState(false)
	const toggle = (next: boolean) => {
		setActive(next)
		if (next) onToggleOpen?.(true)
		else onToggleClose?.()
	}
	return (
		<div className="popup">
			<button
				className={buttonClassName}
				disabled={disabled}
				onClick={() => toggle(!active)}
				type="button"
			>
				{button}
			</button>
			{createPortal(
				<div className={active ? 'popup__content' : 'popup__hidden-content'}>
					<div className="popup__scroll-container">
						{renderPanel?.({ close: () => toggle(false) })}
					</div>
				</div>,
				document.body
			)}
		</div>
	)
}

vi.mock('@payloadcms/ui', () => ({
	ChevronIcon: () => null,
	Popup: PopupDouble,
	SearchIcon: () => null,
	useConfig: () => ({ config: { routes: { api: '/api' }, serverURL: '' } }),
}))
vi.mock('../../../translations/useTranslation', () => ({
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, unknown>) =>
			vars ? `${key} ${Object.values(vars).join(' ')}` : key,
	}),
}))

const { CountryPicker } = await import('./CountryPicker')

const OPTIONS: { priority: CountryOption[]; rest: CountryOption[] } = {
	priority: [
		{ callingCode: '49', code: 'DE', name: 'Germany' },
		{ callingCode: '33', code: 'FR', name: 'France' },
	],
	rest: [
		{ callingCode: '61', code: 'AU', name: 'Australia' },
		{ callingCode: '81', code: 'JP', name: 'Japan' },
		{ callingCode: '1', code: 'US', name: 'United States' },
	],
}

const REGIONAL_INDICATORS = /\p{Regional_Indicator}{2}/u

/** Forty real codes, so a stored country can sit far below the visible window. */
const LONG_CODES = (
	'AD AE AF AG AI AL AM AO AR AT AU AW AZ BA BB BD BE BF BG BH ' +
	'BI BJ BM BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN'
).split(' ') as CountryCode[]

const LONG = {
	priority: [],
	rest: LONG_CODES.map((code, index) => ({
		callingCode: String(200 + index),
		code,
		name: `Country ${code}`,
	})),
}

type PickerProps = {
	disabled?: boolean
	flags?: PhoneFlagMode
	options?: { priority: CountryOption[]; rest: CountryOption[] }
	priorityLabel?: string
	value?: CountryCode
}

const picker = (props: PickerProps, onSelect: (code: CountryCode) => void) => (
	<CountryPicker
		disabled={props.disabled ?? false}
		flags={props.flags ?? 'svg'}
		onSelect={onSelect}
		options={props.options ?? OPTIONS}
		priorityLabel={props.priorityLabel}
		value={props.value}
	/>
)

const renderPicker = (props: PickerProps = {}) => {
	const onSelect = vi.fn()
	const { rerender } = render(picker(props, onSelect))
	return { onSelect, rerender: (next: PickerProps) => rerender(picker(next, onSelect)) }
}

const trigger = () => screen.getByRole('button')
const open = () => fireEvent.click(trigger())

const panel = (): HTMLElement => {
	const element = document.querySelector<HTMLElement>('.fields-phone__panel')
	if (!element) throw new Error('the picker panel is not rendered')
	return element
}

/** Group headers and options in the order the list paints them. */
const rowTexts = (): string[] =>
	[...panel().querySelectorAll('.fields-phone__group, .fields-phone__option')].map((row) =>
		(row.textContent ?? '').trim()
	)

const optionNames = (): string[] =>
	screen
		.queryAllByRole('option')
		.map((option) => option.querySelector('.fields-phone__option-name')?.textContent ?? '')

const search = () => screen.getByRole('combobox')

const type = (query: string) => fireEvent.change(search(), { target: { value: query } })

/** The scroll that won: virtual-core also syncs the element's own offset when it attaches. */
const lastScrollTop = (): number => {
	const call = scrollTo.mock.lastCall
	if (!call) throw new Error('the list was never scrolled')
	return call[0]?.top ?? -1
}

const activeOptionText = (): string => {
	const id = search().getAttribute('aria-activedescendant')
	if (!id) throw new Error('the search box points at no active option')
	const active = document.getElementById(id)
	if (!active) throw new Error(`the active option ${id} is not rendered`)
	return active.textContent ?? ''
}

describe('CountryPicker', () => {
	// `globals: false` in the vitest config means testing-library registers no
	// auto-cleanup, so renders would otherwise stack across cases.
	afterEach(() => {
		cleanup()
		scrollTo.mockClear()
	})

	// Payload's Popup calls `render` whether or not the popup is open, so a panel that
	// did not gate on its own open state would build every row for every closed field.
	it('builds no panel until the trigger is opened', () => {
		renderPicker()
		expect(screen.queryByRole('listbox')).toBeNull()
		expect(screen.queryAllByRole('option')).toHaveLength(0)
	})

	// The panel is portalled to the body and absolutely positioned, so a plain focus scrolls
	// the page to it and drags the row the viewer is reading out from under them.
	it('focuses the search on open, without scrolling the page to the panel', () => {
		const focus = vi.spyOn(HTMLInputElement.prototype, 'focus')
		try {
			renderPicker()
			open()
			expect(focus).toHaveBeenCalledWith({ preventScroll: true })
		} finally {
			focus.mockRestore()
		}
	})

	it('lists the priority countries above the rest, heading them with the given label', () => {
		renderPicker({ priorityLabel: 'Popular' })
		open()
		expect(rowTexts()).toEqual([
			'Popular',
			'Germany+49',
			'France+33',
			'',
			'Australia+61',
			'Japan+81',
			'United States+1',
		])
	})

	it('separates the priority countries with a plain divider when no label is given', () => {
		renderPicker()
		open()
		// Not just "no heading text": a group element still renders as the divider between
		// the two clusters, distinct from rendering nothing at all.
		const groups = panel().querySelectorAll('.fields-phone__group')
		expect(groups).toHaveLength(1)
		expect(groups[0]?.textContent).toBe('')
		expect(optionNames()).toEqual(['Germany', 'France', 'Australia', 'Japan', 'United States'])
	})

	it('drops the separator entirely when no priority countries are configured', () => {
		renderPicker({ options: { priority: [], rest: OPTIONS.rest } })
		open()
		expect(panel().querySelectorAll('.fields-phone__group')).toHaveLength(0)
		expect(optionNames()).toEqual(['Australia', 'Japan', 'United States'])
	})

	it('drops the separator when every offered country is a priority country', () => {
		renderPicker({ options: { priority: OPTIONS.priority, rest: [] }, priorityLabel: 'Popular' })
		open()
		expect(panel().querySelectorAll('.fields-phone__group')).toHaveLength(0)
		expect(optionNames()).toEqual(['Germany', 'France'])
	})

	it('filters by localized name', () => {
		renderPicker()
		open()
		type('fran')
		expect(optionNames()).toEqual(['France'])
	})

	it('filters by ISO code, which no matching name contains', () => {
		renderPicker()
		open()
		type('jp')
		expect(optionNames()).toEqual(['Japan'])
	})

	it('filters by calling code, ignoring a leading plus', () => {
		renderPicker()
		open()
		type('+61')
		expect(optionNames()).toEqual(['Australia'])
	})

	it('shows the empty state, and no options, when nothing matches', () => {
		renderPicker()
		open()
		type('zzzz')
		expect(optionNames()).toEqual([])
		expect(panel().textContent).toContain('fields:noCountriesFound')
	})

	it('reports the clicked country and closes the panel', () => {
		const { onSelect } = renderPicker()
		open()
		const japan = screen.getAllByRole('option')[3]
		if (!japan) throw new Error('Japan is not rendered')
		fireEvent.click(japan)
		expect(onSelect).toHaveBeenCalledWith('JP')
		expect(screen.queryAllByRole('option')).toHaveLength(0)
	})

	it('moves the active option with the arrow keys, stepping over the divider', () => {
		renderPicker({ value: 'DE' })
		open()
		expect(activeOptionText()).toContain('Germany')
		fireEvent.keyDown(search(), { key: 'ArrowDown' })
		expect(activeOptionText()).toContain('France')
		fireEvent.keyDown(search(), { key: 'ArrowDown' })
		expect(activeOptionText()).toContain('Australia')
		fireEvent.keyDown(search(), { key: 'ArrowUp' })
		expect(activeOptionText()).toContain('France')
	})

	it('follows the query, highlighting the first match', () => {
		renderPicker({ value: 'US' })
		open()
		expect(activeOptionText()).toContain('United States')
		type('jp')
		expect(activeOptionText()).toContain('Japan')
	})

	// A Payload form re-renders its fields constantly, and an options list rebuilt on
	// each of those renders must not drag the highlight back to the stored country.
	it('leaves the active option alone when the parent re-renders', () => {
		const { rerender } = renderPicker({ value: 'DE' })
		open()
		fireEvent.keyDown(search(), { key: 'ArrowDown' })
		expect(activeOptionText()).toContain('France')
		rerender({
			options: { priority: [...OPTIONS.priority], rest: [...OPTIONS.rest] },
			value: 'DE',
		})
		expect(activeOptionText()).toContain('France')
	})

	// aria-activedescendant has to name a rendered element, and the virtualizer renders
	// only what is in view.
	it('scrolls a stored country far below the window into view', () => {
		renderPicker({ options: LONG, value: 'CM' })
		open()
		expect(lastScrollTop()).toBeGreaterThan(0)
		expect(activeOptionText()).toContain('Country CM')
	})

	it('leaves the list at the top when the stored country is the first one', () => {
		renderPicker({ options: LONG, value: 'AD' })
		open()
		expect(lastScrollTop()).toBe(0)
	})

	it('counts options over the whole list, not over the rendered window', () => {
		renderPicker()
		open()
		const australia = screen.getAllByRole('option')[2]
		expect(australia?.getAttribute('aria-posinset')).toBe('3')
		expect(australia?.getAttribute('aria-setsize')).toBe('5')
	})

	it('reports the combobox as collapsed while nothing matches', () => {
		renderPicker()
		open()
		expect(search().getAttribute('aria-expanded')).toBe('true')
		type('zzzz')
		expect(search().getAttribute('aria-expanded')).toBe('false')
		expect(search().getAttribute('aria-controls')).toBeNull()
	})

	it('reports the active option on Enter', () => {
		const { onSelect } = renderPicker({ value: 'DE' })
		open()
		fireEvent.keyDown(search(), { key: 'ArrowDown' })
		fireEvent.keyDown(search(), { key: 'Enter' })
		expect(onSelect).toHaveBeenCalledWith('FR')
		expect(screen.queryAllByRole('option')).toHaveLength(0)
	})

	it('cannot be opened while disabled', () => {
		renderPicker({ disabled: true, value: 'DE' })
		expect(trigger()).toHaveProperty('disabled', true)
		open()
		expect(screen.queryByRole('listbox')).toBeNull()
	})

	it('names the trigger after the selected country', () => {
		renderPicker({ value: 'DE' })
		expect(trigger().textContent).toContain('fields:phoneCountryFor Germany')
	})

	it('renders no flag at all in none mode', () => {
		renderPicker({ flags: 'none', value: 'DE' })
		open()
		const germany = screen.getAllByRole('option')[0]
		expect(panel().querySelectorAll('img')).toHaveLength(0)
		expect(germany?.textContent).toBe('Germany+49')
	})

	it('renders emoji flags as text rather than artwork requests', () => {
		renderPicker({ flags: 'emoji', value: 'DE' })
		open()
		const germany = screen.getAllByRole('option')[0]
		expect(panel().querySelectorAll('img')).toHaveLength(0)
		expect(germany?.textContent).toMatch(REGIONAL_INDICATORS)
	})

	it('passes svg mode through to every row', () => {
		renderPicker({ flags: 'svg', value: 'DE' })
		open()
		expect(panel().querySelectorAll('img')).toHaveLength(5)
		const germany = screen.getAllByRole('option')[0]
		expect(germany?.querySelector('img')?.getAttribute('src')).toBe('/api/10x-fields/flags/de.svg')
	})
})
