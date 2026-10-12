'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'
import type { Granularity, MetricKey } from '../core/contract'
import type { WireSource } from '../fields/config/fetchSources'
import type { ItemLabels } from '../query/response'
import type { ReadNotices } from '../widgets/readMeta'
import type { DayRange, ViewGate } from './gating'
import type { ViewState } from './state'
import type { ViewQueries } from './useViewQueries'
import type { AnalyticsViewClientProps } from './viewProps'

/**
 * What every read on the page has said so far, merged; empty until one answers.
 *
 * @beta
 */
export interface ViewAnswers {
	/** The source that answered, which decides how a channel or source value reads. */
	provider: string
	/** The ISO code revenue renders in: the answering source's, else the install's. */
	currency?: string
	/** Titles behind item refs, for an item row or chip. */
	itemLabels?: ItemLabels
	/** The caveats any read carries, captioned once beside the range. */
	notices: ReadNotices
	/** The range's visitor total a rate column divides by. */
	siteVisitors?: number
}

/** @beta */
export interface ViewRefresh {
	run: () => void
	pending: boolean
	failed: boolean
	/** The latest refresh succeeded, which the toolbar says once. */
	done?: boolean
}

/**
 * What the source behind the view lets a section offer.
 *
 * @beta
 */
export interface ReadonlyViewGate {
	/** The metrics of the cards and the trend, which read the whole site. */
	readonly metrics: readonly MetricKey[]
	/** Buckets the view offers, coarsest-inclusive. Never finer than an hour. */
	readonly granularities: readonly Granularity[]
	/** Days the source can look back, or null for no limit. */
	readonly maxRangeDays: number | null
	readonly canCompare: boolean
	readonly canHour: boolean
	readonly realtime: boolean
	readonly goals: boolean
}

/**
 * What a section reads of the view it renders in.
 *
 * @beta
 */
export interface ViewContextValue {
	state: ViewState
	/** The committed state as one string; any change to it is a new view. */
	stateKey: string
	/** The source the reads resolved to, which may not be the one the address names. */
	source: WireSource
	gate: ReadonlyViewGate
	range: DayRange
	now: Date
	queries: ViewQueries
	answers: ViewAnswers
	/** A step the reader took. */
	write: (next: ViewState) => void
	refresh: ViewRefresh
}

/** What the plugin's own sections read: the public value plus server props and the full gate. */
export interface ViewFrame extends Omit<ViewContextValue, 'gate'> {
	props: AnalyticsViewClientProps
	gate: ViewGate
}

const ViewContext = createContext<ViewFrame | null>(null)

export function ViewProvider({ value, children }: { value: ViewFrame; children: ReactNode }) {
	return <ViewContext.Provider value={value}>{children}</ViewContext.Provider>
}

/** The view a plugin section is rendered in, which `ViewRoot` provides. */
export const useViewFrame = (): ViewFrame => {
	const value = useContext(ViewContext)
	if (value === null) {
		throw new Error('analytics: a view section rendered outside ViewRoot')
	}
	return value
}

/**
 * The view a section is rendered in, which `ViewRoot` provides.
 *
 * @beta
 */
export const useView = (): ViewContextValue => {
	const frame = useViewFrame()
	return useMemo(
		() => ({
			state: frame.state,
			stateKey: frame.stateKey,
			source: frame.source,
			gate: {
				metrics: frame.gate.metrics,
				granularities: frame.gate.granularities,
				maxRangeDays: frame.gate.maxRangeDays,
				canCompare: frame.gate.canCompare,
				canHour: frame.gate.canHour,
				realtime: frame.gate.realtime,
				goals: frame.gate.goals,
			},
			range: frame.range,
			now: frame.now,
			queries: frame.queries,
			answers: frame.answers,
			write: frame.write,
			refresh: frame.refresh,
		}),
		[frame]
	)
}
