'use client'

import { useMemo } from 'react'
import { filterOperatorsFor } from '../../core/capabilities'
import {
	DIMENSION_KEYS,
	type DimensionKey,
	FILTER_OPERATORS,
	type FilterOperator,
} from '../../core/contract'
import type { WireSource } from './fetchSources'
import { useAnalyticsSources } from './useAnalyticsSources'
import { useFormString } from './useFormString'

/** @beta */
export interface FilterCapabilities {
	/** Dimensions the widget may filter on, in contract order. */
	dimensions: DimensionKey[]
	/** Operators the widget may filter some offered dimension with, in contract order. */
	operators: FilterOperator[]
	/** The operators the widget may filter one dimension with, in contract order. */
	operatorsFor: (dimension: DimensionKey) => FilterOperator[]
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

type SourceFilters = Pick<FilterCapabilities, 'dimensions' | 'operators' | 'operatorsFor'>

const EMPTY: SourceFilters = {
	dimensions: [],
	operators: [],
	operatorsFor: () => [],
}

/**
 * A filter an editor cannot write by hand: an item filter takes a ref (`offers:12`), which names
 * nothing an editor would recognize. The analytics view sets one from a row of its Content tab.
 */
const UNTYPED_DIMENSIONS: ReadonlySet<DimensionKey> = new Set<DimensionKey>(['item'])

/**
 * What the chosen source can filter by. An unknown source id falls back to the union over all
 * sources, which is also what a single-provider install (no source field) sees.
 */
const deriveFilterCapabilities = (args: {
	sources: WireSource[] | null
	sourceId: string | undefined
}): SourceFilters => {
	const { sourceId, sources } = args
	if (!sources || sources.length === 0) return EMPTY
	const picked = sourceId ? sources.find((s) => s.id === sourceId) : undefined
	const scope = picked ? [picked] : sources
	const operatorsFor = (dimension: DimensionKey): FilterOperator[] =>
		UNTYPED_DIMENSIONS.has(dimension)
			? []
			: FILTER_OPERATORS.filter((operator) =>
					scope.some((s) => filterOperatorsFor(s.capabilities, dimension).includes(operator))
				)
	const dimensions = DIMENSION_KEYS.filter((d) => operatorsFor(d).length > 0)
	return {
		dimensions,
		operators: FILTER_OPERATORS.filter((operator) =>
			dimensions.some((d) => operatorsFor(d).includes(operator))
		),
		operatorsFor,
	}
}

/**
 * Filter capabilities for the source the config form points at. `dataSourcePath` is a form
 * path, not a sibling lookup: a custom widget whose source field sits elsewhere passes its own.
 *
 * @beta
 */
export const useFilterCapabilities = (dataSourcePath = 'dataSource'): FilterCapabilities => {
	const { error, loading, sources } = useAnalyticsSources()
	const sourceId = useFormString(dataSourcePath)
	const { dimensions, operators, operatorsFor } = useMemo(
		() => deriveFilterCapabilities({ sourceId, sources }),
		[sourceId, sources]
	)
	return { dimensions, error, loading, operators, operatorsFor, resolved: sources !== null }
}
