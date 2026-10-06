'use client'

import { useFormFields } from '@payloadcms/ui'
import { useMemo } from 'react'
import {
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
} from '../../core/contract'
import type { WireSource } from './fetchSources'
import { useAnalyticsSources } from './useAnalyticsSources'

export interface FilterCapabilities {
	/** Dimensions the widget may filter on, in contract order. */
	dimensions: DimensionKey[]
	/** Operators the widget may filter with, in contract order. */
	operators: FilterOperator[]
	/** The source list has yet to answer; offer nothing rather than a wrong list. */
	loading: boolean
	/** The source list could not be fetched, so an empty offer is not a verdict. */
	error: boolean
	/**
	 * A source list actually answered. False covers both the pending fetch and the window
	 * before there is a user to fetch for, where nothing offered is not yet a verdict.
	 */
	resolved: boolean
}

const EMPTY: Pick<FilterCapabilities, 'dimensions' | 'operators'> = {
	dimensions: [],
	operators: [],
}

/**
 * What the widget's chosen source can filter by. An unknown source id (a stale value, a
 * runtime source the endpoint could not list) falls back to the union, mirroring the
 * metric picker's narrowing; the union is also what a single-provider install sees, where
 * there is no source field to read.
 */
export const deriveFilterCapabilities = (args: {
	sources: WireSource[] | null
	sourceId: string | undefined
}): Pick<FilterCapabilities, 'dimensions' | 'operators'> => {
	const { sourceId, sources } = args
	if (!sources || sources.length === 0) return EMPTY
	const picked = sourceId ? sources.find((s) => s.id === sourceId) : undefined
	const scope = picked ? [picked] : sources
	return {
		dimensions: DIMENSION_KEYS.filter((d) => scope.some((s) => s.capabilities.filters.includes(d))),
		operators: FILTER_OPERATORS.filter((op) =>
			scope.some((s) => s.capabilities.filterOperators.includes(op))
		),
	}
}

/**
 * Filter capabilities for the source a widget's config form currently points at, read
 * from that field's value in form state. `dataSourcePath` is a form path, not a relative
 * sibling lookup: it defaults to the top-level `dataSource` the widget config forms use,
 * and a custom widget whose source field sits elsewhere passes its own path, exactly as
 * `MetricSelectField` does.
 */
export const useFilterCapabilities = (dataSourcePath = 'dataSource'): FilterCapabilities => {
	const { error, loading, sources } = useAnalyticsSources()
	const sourceId = useFormFields(
		([fields]) => fields?.[dataSourcePath]?.value as string | undefined
	)
	const { dimensions, operators } = useMemo(
		() => deriveFilterCapabilities({ sourceId, sources }),
		[sourceId, sources]
	)
	return { dimensions, error, loading, operators, resolved: sources !== null }
}
