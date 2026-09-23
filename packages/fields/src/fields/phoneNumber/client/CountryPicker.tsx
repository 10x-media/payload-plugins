'use client'

import { ChevronIcon, Popup, SearchIcon } from '@payloadcms/ui'
import { useVirtualizer } from '@tanstack/react-virtual'
import type React from 'react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { keys } from '../../../translations/keys'
import { useTranslation } from '../../../translations/useTranslation'
import type { CountryOption } from '../engine/countries'
import type { CountryCode } from '../engine/phone'
import type { PhoneFlagMode } from '../options'
import { CountryFlag } from './CountryFlag'
import './phoneNumberField.css'

const baseClass = 'fields-phone'

// Headings, the divider, and options share one height, so the virtualizer's estimate is
// exact and the rows it positions can never drift from what the CSS paints.
const ROW_HEIGHT = 34
const estimateRow = () => ROW_HEIGHT

export type CountryOptionGroups = {
	priority: CountryOption[]
	rest: CountryOption[]
}

type PickerRow =
	| { kind: 'divider' }
	| { kind: 'heading'; label: string }
	| { kind: 'option'; option: CountryOption }

const matchesQuery = (option: CountryOption, query: string): boolean => {
	if (option.name.toLowerCase().includes(query)) return true
	if (option.code.toLowerCase().startsWith(query)) return true
	const digits = query.replace(/\D/g, '')
	return digits !== '' && option.callingCode.startsWith(digits)
}

const filterOptions = (options: CountryOption[], query: string): CountryOption[] =>
	query === '' ? options : options.filter((option) => matchesQuery(option, query))

/**
 * The priority heading renders only with a caller-given label; the plain divider before
 * `rest` carries the split otherwise. Neither appears when either group is empty, since
 * there is then nothing to separate from.
 */
const buildRows = (
	options: CountryOptionGroups,
	query: string,
	priorityLabel: string | undefined
): PickerRow[] => {
	const priority = filterOptions(options.priority, query)
	const rest = filterOptions(options.rest, query)
	const split = priority.length > 0 && rest.length > 0
	return [
		...(split && priorityLabel !== undefined
			? [{ kind: 'heading', label: priorityLabel } as const]
			: []),
		...priority.map((option) => ({ kind: 'option', option }) as const),
		...(split ? [{ kind: 'divider' } as const] : []),
		...rest.map((option) => ({ kind: 'option', option }) as const),
	]
}

type CountryPanelProps = {
	close: () => void
	flags: PhoneFlagMode
	onSelect: (code: CountryCode) => void
	options: CountryOptionGroups
	priorityLabel?: string
	value: CountryCode | undefined
}

const CountryPanel: React.FC<CountryPanelProps> = ({
	close,
	flags,
	onSelect,
	options,
	priorityLabel,
	value,
}) => {
	const { t } = useTranslation()
	const [query, setQuery] = useState('')
	const listRef = useRef<HTMLDivElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)
	const listId = useId()

	// The panel is portalled to the body and absolutely positioned, so a plain focus scrolls
	// the page to it and drags the row the viewer is reading out from under them.
	useEffect(() => {
		searchRef.current?.focus({ preventScroll: true })
	}, [])

	const rows = useMemo(
		() => buildRows(options, query.trim().toLowerCase(), priorityLabel),
		[options, priorityLabel, query]
	)
	const optionRows = useMemo(
		() => rows.flatMap((row, index) => (row.kind === 'option' ? [index] : [])),
		[rows]
	)

	const virtualizer = useVirtualizer({
		count: rows.length,
		estimateSize: estimateRow,
		getScrollElement: () => listRef.current,
		overscan: 6,
	})

	const [activeRow, setActiveRow] = useState(-1)
	// biome-ignore lint/correctness/useExhaustiveDependencies: the query is the trigger; re-seeding on every parent render would fight the arrow keys
	useEffect(() => {
		const selected = rows.findIndex((row) => row.kind === 'option' && row.option.code === value)
		const next = selected >= 0 ? selected : (optionRows[0] ?? -1)
		setActiveRow(next)
		// aria-activedescendant has to name a rendered element, and the virtualizer only
		// renders what is in view: opening on the 200th country must scroll to it.
		if (next >= 0) virtualizer.scrollToIndex(next, { align: 'center' })
	}, [query])

	const select = useCallback(
		(code: CountryCode) => {
			onSelect(code)
			close()
		},
		[close, onSelect]
	)

	const move = useCallback(
		(step: number) => {
			const position = optionRows.indexOf(activeRow)
			const next = optionRows[Math.min(Math.max(position + step, 0), optionRows.length - 1)]
			if (next === undefined) return
			setActiveRow(next)
			virtualizer.scrollToIndex(next)
		},
		[activeRow, optionRows, virtualizer]
	)

	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			// The arrows drive this list, so they stop here: Payload's Popup otherwise walks
			// focus between the panel's tabbables, which is why rows carry tabIndex={-1}.
			event.preventDefault()
			event.stopPropagation()
			move(event.key === 'ArrowDown' ? 1 : -1)
			return
		}
		if (event.key === 'Enter') {
			event.preventDefault()
			const row = rows[activeRow]
			if (row?.kind === 'option') select(row.option.code)
		}
	}

	const optionId = (index: number) => `${listId}-option-${index}`
	const populated = rows.length > 0
	// A listbox must own option children, so the list claims the role only once it holds
	// options; while empty it is a plain container around the no-results message.
	const listA11y: React.HTMLAttributes<HTMLDivElement> = populated
		? { 'aria-label': t(keys.selectCountry), role: 'listbox' }
		: {}

	return (
		<div className={`${baseClass}__panel`}>
			<div className={`${baseClass}__search`}>
				<span aria-hidden="true" className={`${baseClass}__search-icon`}>
					<SearchIcon />
				</span>
				<input
					aria-activedescendant={
						rows[activeRow]?.kind === 'option' ? optionId(activeRow) : undefined
					}
					aria-autocomplete="list"
					aria-controls={populated ? listId : undefined}
					aria-expanded={populated}
					aria-label={t(keys.searchCountries)}
					className={`${baseClass}__search-input`}
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={t(keys.searchCountries)}
					ref={searchRef}
					role="combobox"
					type="text"
					value={query}
				/>
			</div>
			<div className={`${baseClass}__list`} id={listId} ref={listRef} {...listA11y}>
				{populated ? (
					<div
						role="presentation"
						style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
					>
						{virtualizer.getVirtualItems().map((item) => {
							const row = rows[item.index]
							if (!row) return null
							const style: React.CSSProperties = {
								height: `${item.size}px`,
								left: 0,
								position: 'absolute',
								top: 0,
								transform: `translateY(${item.start}px)`,
								width: '100%',
							}
							if (row.kind === 'heading') {
								return (
									<div
										className={`${baseClass}__group`}
										key="heading"
										role="presentation"
										style={style}
									>
										{row.label}
									</div>
								)
							}
							if (row.kind === 'divider') {
								return (
									<div
										className={`${baseClass}__group`}
										key="divider"
										role="presentation"
										style={style}
									/>
								)
							}
							return (
								<button
									// Only a dozen rows are ever in the DOM, so a screen reader would otherwise
									// count the window instead of the list and announce "1 of 12" for 250 countries.
									aria-posinset={optionRows.indexOf(item.index) + 1}
									aria-selected={row.option.code === value}
									aria-setsize={optionRows.length}
									className={`${baseClass}__option`}
									data-active={item.index === activeRow || undefined}
									id={optionId(item.index)}
									key={row.option.code}
									onClick={() => select(row.option.code)}
									role="option"
									style={style}
									tabIndex={-1}
									type="button"
								>
									<CountryFlag code={row.option.code} mode={flags} />
									<span className={`${baseClass}__option-name`}>{row.option.name}</span>
									<span
										className={`${baseClass}__option-code`}
									>{`+${row.option.callingCode}`}</span>
								</button>
							)
						})}
					</div>
				) : (
					<div className={`${baseClass}__empty`}>{t(keys.noCountriesFound)}</div>
				)}
			</div>
		</div>
	)
}

export type CountryPickerProps = {
	disabled: boolean
	flags: PhoneFlagMode
	onSelect: (code: CountryCode) => void
	options: CountryOptionGroups
	priorityLabel?: string
	value: CountryCode | undefined
}

export const CountryPicker: React.FC<CountryPickerProps> = ({
	disabled,
	flags,
	onSelect,
	options,
	priorityLabel,
	value,
}) => {
	const { t } = useTranslation()
	// Payload's Popup renders its panel whether or not it is open, so the list is gated on
	// this instead: a closed field builds no rows, and reopening starts from a clean search.
	const [open, setOpen] = useState(false)

	const selected = useMemo(
		() => [...options.priority, ...options.rest].find((option) => option.code === value),
		[options, value]
	)
	const label =
		value === undefined
			? t(keys.selectCountry)
			: t(keys.phoneCountryFor, { country: selected?.name ?? value })

	const renderFace = () => {
		if (value === undefined) return null
		if (flags === 'none') return <span className={`${baseClass}__code`}>{value}</span>
		return <CountryFlag code={value} mode={flags} />
	}

	return (
		<Popup
			button={
				<>
					{renderFace()}
					<span className={`${baseClass}__sr-only`}>{label}</span>
					<span aria-hidden="true" className={`${baseClass}__caret`}>
						<ChevronIcon />
					</span>
				</>
			}
			buttonClassName={`${baseClass}__trigger`}
			buttonType="default"
			caret={false}
			className={`${baseClass}__picker`}
			disabled={disabled}
			horizontalAlign="left"
			onToggleClose={() => setOpen(false)}
			onToggleOpen={() => setOpen(true)}
			render={({ close }) =>
				open ? (
					<CountryPanel
						close={close}
						flags={flags}
						onSelect={onSelect}
						options={options}
						priorityLabel={priorityLabel}
						value={value}
					/>
				) : null
			}
			size="fit-content"
			verticalAlign="bottom"
		/>
	)
}
