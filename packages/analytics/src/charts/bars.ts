import type { ReactNode } from 'react'
import type { MetricValue } from '../core/contract'

/** @beta */
export interface BarDatum {
	label: string
	/** `null` is no reading for the row: no bar, and a dash where no `display` says otherwise. */
	value: MetricValue
	display?: string
	/** A second, unbarred column (the view's `visitors` beside the charted metric). */
	secondary?: string
	/** A third, unbarred column (the events and goals tabs' conversion rate). */
	tertiary?: string
	/** A fourth, unbarred column (the Content tab's conversions, after its click rate). */
	quaternary?: string
	/**
	 * Drawn before the label and hidden from assistive tech: a country flag reads as the
	 * name beside it, so announcing both says the same thing twice.
	 */
	decoration?: ReactNode
	/** `false` keeps this one row inert in a list that is otherwise selectable. */
	selectable?: boolean
}

export interface BarRow extends BarDatum {
	/** The value's share of the largest, from {@link barShares}. */
	fraction: number
}

/**
 * Each value as a `[0, 1]` fraction of the largest; an all-zero set and a missing reading draw no
 * bar, never a divide by zero.
 */
export const barShares = (values: readonly MetricValue[]): number[] => {
	const max = values.reduce<number>((m, value) => Math.max(m, value ?? 0), 0)
	return values.map((value) => (max > 0 && value !== null ? value / max : 0))
}

/** Each datum with its {@link barShares} fraction, for a ranked bar list. */
export const toBarRows = (data: BarDatum[]): BarRow[] => {
	const shares = barShares(data.map((d) => d.value))
	return data.map((d, i) => ({ ...d, fraction: shares[i] ?? 0 }))
}
