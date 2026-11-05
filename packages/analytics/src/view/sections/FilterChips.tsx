'use client'

import { Pill, XIcon } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'
import type { AnalyticsFilter } from '../../core/contract'
import type { ItemLabels } from '../../query/response'
import { keys } from '../../translations/keys'
import { FILTER_OPERATOR_KEYS } from '../../translations/metricKeys'
import { cutAtMark, isolate, MARK } from '../../translations/parts'
import { useTranslation } from '../../translations/useTranslation'
import { type CountryFlags, RowFlag } from '../CountryFlag'
import { countryCode, DIMENSION_LABELS, valueLabel } from '../labels'
import { filterKey } from '../state'
import type { ViewGoal } from '../viewProps'

export interface FilterChipsProps {
	filters: AnalyticsFilter[]
	/** The source that answered, which decides whether a `source` value names a channel. */
	provider: string
	/** Admin UI language the country and language names read in. */
	locale: string
	/** Configured goals, for the name behind a goal slug. */
	goals: ViewGoal[]
	/** The flag beside a country name: none, the plugin's own, or the host's component. */
	countryFlags: CountryFlags
	/** Titles behind item refs, so an item chip names the item rather than its ref. */
	itemLabels?: ItemLabels
	onRemove: (index: number) => void
}

export interface FilterChipProps {
	filter: AnalyticsFilter
	/** The value as a reader knows it: a country's name, a goal's, an item's title. */
	shown: string
	countryFlags: CountryFlags
	onRemove: () => void
}

/**
 * One filter as a removable pill worded as a sentence ("Country is Germany"); the value keeps its
 * own reading direction whichever way the page reads.
 */
export function FilterChip({ filter, shown, countryFlags, onRemove }: FilterChipProps) {
	const { t } = useTranslation()
	const words = {
		dimension: t(DIMENSION_LABELS[filter.dimension]),
		operator: t(FILTER_OPERATOR_KEYS[filter.operator]),
	}
	const { before, after } = cutAtMark(t(keys.viewFilterChip, { ...words, value: MARK }))
	const named = t(keys.viewFilterChip, { ...words, value: isolate(shown) })
	const flag =
		countryFlags !== false && filter.dimension === 'country' ? countryCode(filter.value) : null
	return (
		<Pill size="small">
			{before}
			{flag === null ? null : (
				<>
					<RowFlag code={flag} flags={countryFlags} />{' '}
				</>
			)}
			<bdi>{shown}</bdi>
			{after}
			<button
				aria-label={t(keys.viewFilterRemove, { filter: named })}
				className="analytics-view__chip-remove"
				onClick={onRemove}
				type="button"
			>
				<XIcon />
			</button>
		</Pill>
	)
}

/**
 * Removable filter pills. Removing one moves focus to the chip taking its place, the one before,
 * or the row label once none is left, which stays until focus moves on.
 */
export function FilterChips({
	filters,
	provider,
	locale,
	goals,
	countryFlags,
	itemLabels,
	onRemove,
}: FilterChipsProps) {
	const { t } = useTranslation()
	const row = useRef<HTMLDivElement>(null)
	const heading = useRef<HTMLSpanElement>(null)
	const [refocus, setRefocus] = useState<{ index: number; remaining: number } | null>(null)
	const [holding, setHolding] = useState(false)

	useEffect(() => {
		if (refocus === null || filters.length !== refocus.remaining) {
			return
		}
		const buttons = row.current?.querySelectorAll<HTMLButtonElement>('.analytics-view__chip-remove')
		const next = buttons?.[Math.min(refocus.index, buttons.length - 1)]
		if (next) {
			next.focus()
		} else {
			heading.current?.focus()
		}
		setRefocus(null)
	}, [refocus, filters])

	// A press that moves focus off the held label lets go only after its click: collapsing the row
	// between pointer down and up would move the target out from under the pointer.
	useEffect(() => {
		const label = heading.current
		if (!holding || !label) {
			return
		}
		let pressed = false
		let waiting = false
		let timer: ReturnType<typeof setTimeout> | undefined
		const letGo = () => setHolding(false)
		const down = () => {
			pressed = true
		}
		const up = () => {
			pressed = false
			if (waiting) {
				waiting = false
				timer = setTimeout(letGo, 0)
			}
		}
		const release = () => {
			if (pressed) {
				waiting = true
				return
			}
			letGo()
		}
		window.addEventListener('pointerdown', down, true)
		window.addEventListener('pointerup', up)
		window.addEventListener('pointercancel', up)
		label.addEventListener('focusout', release)
		return () => {
			window.removeEventListener('pointerdown', down, true)
			window.removeEventListener('pointerup', up)
			window.removeEventListener('pointercancel', up)
			label.removeEventListener('focusout', release)
			clearTimeout(timer)
		}
	}, [holding])

	if (filters.length === 0 && !holding) {
		return null
	}
	const remove = (index: number): void => {
		const remaining = filters.length - 1
		setRefocus({ index, remaining })
		setHolding(remaining === 0)
		onRemove(index)
	}
	return (
		<div className="analytics-view__chips" ref={row}>
			<span className="analytics-view__label" ref={heading} tabIndex={-1}>
				{t(keys.viewFilters)}
			</span>
			{filters.map((filter, index) => (
				<FilterChip
					countryFlags={countryFlags}
					filter={filter}
					key={filterKey(filter)}
					onRemove={() => remove(index)}
					shown={valueLabel({
						dimension: filter.dimension,
						value: filter.value,
						provider,
						t,
						locale,
						goals,
						...(itemLabels ? { itemLabels } : {}),
					})}
				/>
			))}
		</div>
	)
}
