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

const OPTIONS: { preferred: CountryOption[]; rest: CountryOption[] } = {
	preferred: [
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

type PickerProps = {
	disabled?: boolean
	flags?: PhoneFlagMode
	options?: { preferred: CountryOption[]; rest: CountryOption[] }
	value?: CountryCode
}

const picker = (props: PickerProps, onSelect: (code: CountryCode) => void) => (
	<CountryPicker
		disabled={props.disabled ?? false}
		flags={props.flags ?? 'svg'}
		onSelect={onSelect}
		options={props.options ?? OPTIONS}
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
	afterEach(cleanup)

	// Payload's Popup calls `render` whether or not the popup is open, so a panel that
	// did not gate on its own open state would build every row for every closed field.
	it('builds no panel until the trigger is opened', () => {
		renderPicker()
		expect(screen.queryByRole('listbox')).toBeNull()
		expect(screen.queryAllByRole('option')).toHaveLength(0)
	})

	it('lists the preferred countries above the rest, separated by group headings', () => {
		renderPicker()
		open()
		expect(rowTexts()).toEqual([
			'fields:preferredCountries',
			'Germany+49',
			'France+33',
			'fields:allCountries',
			'Australia+61',
			'Japan+81',
			'United States+1',
		])
	})

	it('drops the headings when no preferred countries are configured', () => {
		renderPicker({ options: { preferred: [], rest: OPTIONS.rest } })
		open()
		expect(panel().querySelectorAll('.fields-phone__group')).toHaveLength(0)
		expect(optionNames()).toEqual(['Australia', 'Japan', 'United States'])
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

	it('moves the active option with the arrow keys, stepping over group headings', () => {
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
			options: { preferred: [...OPTIONS.preferred], rest: [...OPTIONS.rest] },
			value: 'DE',
		})
		expect(activeOptionText()).toContain('France')
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
