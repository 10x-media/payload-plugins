'use client'

import { useEffect, useMemo } from 'react'
import type { WireSource } from '../fields/config/fetchSources'
import { gate, resolveSource, type ViewGate } from './gating'
import {
	coerceState,
	normalizeViewState,
	parseViewState,
	serializeViewState,
	type ViewState,
} from './state'
import { useViewClock } from './useViewClock'
import { useViewUrl } from './useViewUrl'
import type { AnalyticsViewClientProps } from './viewProps'

export interface ViewStateHandle {
	/** The address, corrected to what the resolved scope and the selected source can serve. */
	state: ViewState
	/** `state` as one string; any change to it is a new view. */
	stateKey: string
	/** Source the reads resolve to, maybe not the address's; null when the scope holds none. */
	source: WireSource | null
	/** What that source serves; null with no source. */
	gate: ViewGate | null
	/** The view's one clock, which every range and caption of a render reads. */
	now: Date
	/** Reads the clock again, as a refresh does. */
	tick: () => void
	/** A step the reader took: written to the address, so Back undoes it. */
	write: (next: ViewState) => void
}

/**
 * View state is its address, coerced each render to what scope and source serve. A correction
 * replaces the address rather than pushing, so Back never undoes a step the reader did not take.
 */
export const useViewState = (props: AnalyticsViewClientProps): ViewStateHandle => {
	const clock = useViewClock()
	const url = useViewUrl({ defaults: props.defaults, scope: props.scopeParam })
	const parsed = useMemo(
		() => parseViewState(new URLSearchParams(url.search), props.defaults),
		[url.search, props.defaults]
	)
	const source = resolveSource(props.sources, parsed.source) ?? null
	const served = useMemo(() => (source ? gate(source.capabilities) : null), [source])
	const sourceIds = useMemo(() => props.sources.sources.map((s) => s.id), [props.sources])
	const normalized = normalizeViewState(parsed, {
		sourceIds,
		...(props.scopeParam ? { scope: props.scopeParam } : {}),
	})
	const state = served ? coerceState(normalized, served) : normalized
	const stateKey = serializeViewState(state, props.defaults).toString()
	const replaceUrl = url.replace
	useEffect(() => replaceUrl(stateKey), [stateKey, replaceUrl])
	return {
		state,
		stateKey,
		source,
		gate: served,
		now: clock.now,
		tick: clock.tick,
		write: url.push,
	}
}
